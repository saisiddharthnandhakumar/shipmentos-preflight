import { ExtractionError, getExtractor } from "../ai/extract";
import type { Db } from "../db/client";
import {
  ConflictError,
  LimitError,
  NotFoundError,
  commitBookingChange,
  findCompletedRequest,
  listMessages,
  loadBooking,
  type StoredMessage,
} from "../db/repo";
import { todayUK } from "../domain/dates";
import { missingFields } from "../domain/missing";
import { applyPatch, type Change } from "../domain/patch";
import { composeImportSummary, composeReply, statusLine } from "../domain/reply";
import { parseWorkbook } from "../import/parse-xlsx";
import { importWorkbookBytes } from "./import-service";
import type { ChatPatch, PatchOp } from "../domain/schemas";
import { bookingSnapshot, evaluateDraft, type BookingSnapshot } from "./booking-service";
import { ApiError } from "./http";

export type TurnResponse = {
  bookingId: string;
  revision: number;
  replayed: boolean;
  messages: StoredMessage[];
  changes: Change[];
  warnings: string[];
  snapshot: BookingSnapshot;
};

type TurnInput = {
  db: Db;
  sessionId: string;
  bookingId: string;
  expectedRevision: number;
  requestId: string;
} & ({ kind: "chat"; message: string; operations?: PatchOp[] } | { kind: "edit"; operations: PatchOp[] } | { kind: "confirm" });

export function draftReference(bookingId: string): string {
  return `SOS-${bookingId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export async function runTurn(input: TurnInput): Promise<TurnResponse> {
  const { db, sessionId, bookingId, expectedRevision, requestId } = input;
  const loaded = await loadBooking(db, sessionId, bookingId);
  if (!loaded) throw new ApiError(404, "NOT_FOUND", "That booking was not found in this browser session.");

  // Idempotent replay: the same requestId returns the original stored response.
  const prior = await findCompletedRequest(db, sessionId, bookingId, requestId);
  if (prior) return { ...(prior as TurnResponse), replayed: true };

  if (loaded.row.revision !== expectedRevision) throw conflict(await bookingSnapshot(db, sessionId, bookingId));

  if (loaded.row.source === "excel" && input.kind === "chat")
    throw new ApiError(400, "CHAT_UNSUPPORTED", "Imported bookings are changed with Edit booking, not by chat.");

  const before = loaded.draft;
  const previous = await evaluateDraft(db, before);
  const today = todayUK();

  let patch: ChatPatch = { operations: [] };
  if (input.kind === "chat" && input.operations) {
    patch = { operations: input.operations };
  } else if (input.kind === "chat") {
    const recent = await listMessages(db, sessionId, bookingId, { limit: 6 });
    try {
      patch = await getExtractor()({ message: input.message, draft: before, recentMessages: recent.messages });
    } catch (err) {
      if (err instanceof ExtractionError) throw new ApiError(err.kind === "invalid_output" ? 422 : 503, "AI_UNAVAILABLE", err.message);
      throw err;
    }
  } else if (input.kind === "edit") {
    patch = { operations: input.operations };
  }

  const newId = () => crypto.randomUUID();
  let { draft: after, changes, warnings } = applyPatch(before, patch.operations, { todayUK: today, newId });

  // Dense messages: a focused second extraction pass for fields still unknown (recall, not guessing).
  if (input.kind === "chat" && !input.operations && patch.operations.length >= 3 && input.message.length > 80) {
    const still = missingFields(after);
    if (still.length) {
      try {
        const second = await getExtractor()({ message: input.message, draft: after, recentMessages: [], focusFields: still.map((m) => m.label) });
        if (second.operations.length) {
          const r2 = applyPatch(after, second.operations, { todayUK: today, newId });
          after = r2.draft;
          changes = [...changes, ...r2.changes];
          warnings = [...warnings, ...r2.warnings];
          patch = { ...patch, operations: [...patch.operations, ...second.operations] };
        }
      } catch {
        // The first pass stands; the reply simply asks for what is still missing.
      }
    }
  }
  const evaluation = await evaluateDraft(db, after);

  let messages: { role: "user" | "assistant" | "event"; content: string; meta?: unknown }[];
  if (input.kind === "chat") {
    const reply = composeReply({ draft: after, evaluation, previous, changes, warnings, clarification: patch.clarification, question: patch.question, operationCount: patch.operations.length });
    messages = [
      { role: "user", content: input.message },
      { role: "assistant", content: reply, meta: { status: evaluation.status, changes: changes.length } },
    ];
  } else if (input.kind === "edit") {
    const summary = changes.length ? changes.map((c) => `${c.label} ${c.before} → ${c.after}`).join("; ") : "no fields changed";
    messages = [{ role: "event", content: `Edited directly: ${summary}.${warnings.length ? ` ${warnings.join(" ")}` : ""}` }];
    if (changes.some((c) => !c.quiet)) {
      const reply = composeReply({ draft: after, evaluation, previous, changes, warnings: [], fromEdit: true });
      messages.push({ role: "assistant", content: reply, meta: { status: evaluation.status, changes: changes.length } });
    }
  } else {
    if (evaluation.status === "Draft" || evaluation.status === "Blocked")
      throw new ApiError(409, "NOT_CONFIRMABLE", `This booking is ${evaluation.status} and can't be marked ready to submit yet.`);
    messages = [
      {
        role: "event",
        content: `Sent to ERP (simulated, ref ${draftReference(bookingId)}). No carrier has been contacted. ${statusLine(evaluation)}`,
      },
    ];
  }

  try {
    const result = await commitBookingChange(db, {
      sessionId,
      bookingId,
      expectedRevision,
      requestId,
      kind: input.kind,
      before,
      after,
      patch,
      changedFields: [...new Set(changes.map((c) => c.field))],
      evaluation,
      messages,
      confirm: input.kind === "confirm",
      // Built inside the same transaction, so a retried request always gets the identical response.
      buildResponse: async (revision, stored, tx): Promise<TurnResponse> => ({
        bookingId,
        revision,
        replayed: false,
        messages: stored,
        changes,
        warnings,
        snapshot: (await bookingSnapshot(tx, sessionId, bookingId))!,
      }),
    });
    return { ...(result.response as TurnResponse), replayed: result.replayed };
  } catch (err) {
    if (err instanceof ConflictError) throw conflict(await bookingSnapshot(db, sessionId, bookingId));
    if (err instanceof NotFoundError) throw new ApiError(404, "NOT_FOUND", err.message);
    if (err instanceof LimitError) throw new ApiError(409, "LIMIT_REACHED", err.message);
    throw err;
  }
}

function conflict(snapshot: BookingSnapshot | null) {
  return new ApiError(409, "STALE_REVISION", "This booking changed in another tab or request. The latest version has been loaded — please re-check and resend.", { snapshot });
}

export type ImportTurnResult = ({ kind: "booking" } & TurnResponse) | { kind: "batch"; batchId: string; total: number; filename: string };

/**
 * Read a workbook into this chat. One booking in the file replaces the chat's booking with it (no AI,
 * rules re-run) and the assistant summarises what is there and what is missing. A file holding several
 * bookings can't be one conversation, so it is stored as an upload batch instead.
 */
export async function runImportTurn(input: { db: Db; sessionId: string; bookingId: string; expectedRevision: number; requestId: string; bytes: Buffer; filename: string }): Promise<ImportTurnResult> {
  const { db, sessionId, bookingId, expectedRevision, requestId, bytes, filename } = input;
  const loaded = await loadBooking(db, sessionId, bookingId);
  if (!loaded) throw new ApiError(404, "NOT_FOUND", "That booking was not found in this browser session.");
  if (loaded.row.source !== "chat") throw new ApiError(400, "CHAT_UNSUPPORTED", "Files can only be read into a chat booking.");

  const prior = await findCompletedRequest(db, sessionId, bookingId, requestId);
  if (prior) return { kind: "booking", ...(prior as TurnResponse), replayed: true };
  if (loaded.row.revision !== expectedRevision) throw conflict(await bookingSnapshot(db, sessionId, bookingId));

  const parsed = await parseWorkbook(bytes, () => crypto.randomUUID());
  if (!parsed.bookings.length) {
    const why = parsed.issues.find((i) => i.severity === "error")?.message ?? "It has no booking rows with data.";
    throw new ApiError(422, "NO_BOOKINGS", `I couldn't find a booking in that file. ${why}`);
  }
  if (parsed.bookings.length > 1) {
    const saved = await importWorkbookBytes(db, sessionId, bytes, filename);
    return { kind: "batch", batchId: saved.batchId, total: parsed.bookings.length, filename: saved.filename };
  }

  const one = parsed.bookings[0];
  const before = loaded.draft;
  const after = one.draft;
  const issues = [...parsed.issues, ...one.issues];
  const evaluation = await evaluateDraft(db, after, one.issues);
  const hadData = Object.entries(before).some(([k, v]) => !["originCountry", "currency", "readyDateNote"].includes(k) && (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined));
  const changedFields = (Object.keys(after) as (keyof typeof after)[]).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  const messages = [
    { role: "user" as const, content: `Uploaded ${filename}` },
    { role: "assistant" as const, content: composeImportSummary({ draft: after, evaluation, filename, issues, replaced: hadData }), meta: { status: evaluation.status, import: true } },
  ];
  try {
    const result = await commitBookingChange(db, {
      sessionId,
      bookingId,
      expectedRevision,
      requestId,
      kind: "import",
      before,
      after,
      patch: { file: filename, bookingRow: one.sourceRow },
      changedFields,
      evaluation,
      messages,
      buildResponse: async (revision, stored, tx): Promise<TurnResponse> => ({
        bookingId,
        revision,
        replayed: false,
        messages: stored,
        changes: [],
        warnings: [],
        snapshot: (await bookingSnapshot(tx, sessionId, bookingId))!,
      }),
    });
    return { kind: "booking", ...(result.response as TurnResponse), replayed: result.replayed };
  } catch (err) {
    if (err instanceof ConflictError) throw conflict(await bookingSnapshot(db, sessionId, bookingId));
    if (err instanceof NotFoundError) throw new ApiError(404, "NOT_FOUND", err.message);
    if (err instanceof LimitError) throw new ApiError(409, "LIMIT_REACHED", err.message);
    throw err;
  }
}
