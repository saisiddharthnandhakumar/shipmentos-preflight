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
import { applyPatch, type Change } from "../domain/patch";
import { composeReply, statusLine } from "../domain/reply";
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
} & ({ kind: "chat"; message: string } | { kind: "edit"; operations: PatchOp[] } | { kind: "confirm" });

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
  if (loaded.row.source === "excel" && input.kind !== "confirm")
    throw new ApiError(400, "READ_ONLY", "Imported bookings are read-only here. Fix the spreadsheet and upload it again.");

  const before = loaded.draft;
  const previous = await evaluateDraft(db, before);
  const today = todayUK();

  let patch: ChatPatch = { operations: [] };
  if (input.kind === "chat") {
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

  const { draft: after, changes, warnings } = applyPatch(before, patch.operations, { todayUK: today, newId: () => crypto.randomUUID() });
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
  } else {
    if (evaluation.status === "Draft" || evaluation.status === "Blocked")
      throw new ApiError(409, "NOT_CONFIRMABLE", `This booking is ${evaluation.status} and can't be marked ready to submit yet.`);
    messages = [
      {
        role: "event",
        content: `Saved as a ready-to-submit draft (${draftReference(bookingId)}). ${statusLine(evaluation)}`,
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
