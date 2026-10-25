/**
 * Session-scoped data access. EVERY function takes the cookie-resolved sessionId and constrains
 * its query by it; a booking UUID alone never authorises anything.
 */
import { and, asc, desc, eq, gt, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import {
  bookingItems,
  bookingRevisions,
  bookings,
  chatMessages,
  chatTurnRequests,
  evaluations,
  importBatches,
  importIssues,
} from "./schema";
import { bookingTitle } from "../domain/title";
import type { DraftBooking, DraftItem, Evaluation, InputIssue } from "../domain/schemas";

export type BookingRow = typeof bookings.$inferSelect;
export type ItemRow = typeof bookingItems.$inferSelect;
export type MessageRow = typeof chatMessages.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Exec = Db | Tx;

export class ConflictError extends Error {
  constructor(public currentRevision: number | null, message = "This booking was changed elsewhere. Reload to see the latest version.") {
    super(message);
    this.name = "ConflictError";
  }
}
export class NotFoundError extends Error {
  constructor(message = "Not found in this browser session.") {
    super(message);
    this.name = "NotFoundError";
  }
}
export class LimitError extends Error {}

export const MAX_MESSAGES_PER_THREAD = 300;

// ─── Mapping ──────────────────────────────────────────────────────────────────
const num = (v: string | null): number | null => (v == null ? null : Number(v));
const dec = (v: number | null): string | null => (v == null ? null : v.toFixed(4));

export function rowsToDraft(b: BookingRow, items: ItemRow[]): DraftBooking {
  return {
    externalBookingId: b.externalBookingId,
    sellerName: b.sellerName,
    originCity: b.originCity as DraftBooking["originCity"],
    originCountry: "United Kingdom",
    destinationCity: b.destinationCity,
    destinationCountry: b.destinationCountry as DraftBooking["destinationCountry"],
    destinationType: b.destinationType as DraftBooking["destinationType"],
    readyToShipDate: b.readyToShipDate,
    readyDateNote: (b.readyDateNote as DraftBooking["readyDateNote"]) ?? null,
    sellerPriority: b.sellerPriority as DraftBooking["sellerPriority"],
    pallets: b.pallets,
    cartons: b.cartons,
    totalDeclaredValueGBP: num(b.totalDeclaredValueGbp),
    currency: "GBP",
    totalGrossWeightKg: num(b.totalGrossWeightKg),
    deliveryAppointmentBooked: b.deliveryAppointmentBooked,
    selectedCarrierKey: b.selectedCarrierKey,
    items: [...items]
      .sort((x, y) => x.position - y.position)
      .map((i) => ({
        itemId: i.id,
        sku: i.sku,
        description: i.description,
        hsCode: i.hsCode,
        quantityUnits: i.quantityUnits,
        unitPriceGBP: num(i.unitPriceGbp),
        unitsPerCarton: i.unitsPerCarton,
        cartons: i.cartons,
        unitWeightKg: num(i.unitWeightKg),
        countryOfOrigin: i.countryOfOrigin,
        sourceRow: i.sourceRow,
      })),
  };
}

function draftColumns(d: DraftBooking, e: Evaluation) {
  return {
    externalBookingId: d.externalBookingId,
    title: bookingTitle(d),
    sellerName: d.sellerName,
    originCity: d.originCity,
    originCountry: d.originCountry,
    destinationCity: d.destinationCity,
    destinationCountry: d.destinationCountry,
    destinationType: d.destinationType,
    readyToShipDate: d.readyToShipDate,
    readyDateNote: d.readyDateNote ?? null,
    sellerPriority: d.sellerPriority,
    pallets: d.pallets,
    cartons: d.cartons,
    totalDeclaredValueGbp: dec(d.totalDeclaredValueGBP),
    currency: d.currency,
    totalGrossWeightKg: dec(d.totalGrossWeightKg),
    deliveryAppointmentBooked: d.deliveryAppointmentBooked,
    selectedCarrierKey: d.selectedCarrierKey,
    status: e.status,
    redCount: e.redCount,
    amberCount: e.amberCount,
  };
}

function itemValues(bookingId: string, item: DraftItem, position: number, raw?: unknown) {
  return {
    id: item.itemId,
    bookingId,
    position,
    sku: item.sku,
    description: item.description,
    hsCode: item.hsCode,
    quantityUnits: item.quantityUnits,
    unitPriceGbp: dec(item.unitPriceGBP),
    unitsPerCarton: item.unitsPerCarton,
    cartons: item.cartons,
    unitWeightKg: dec(item.unitWeightKg),
    countryOfOrigin: item.countryOfOrigin,
    sourceRow: item.sourceRow ?? null,
    rawRow: raw ?? null,
  };
}

function evaluationValues(bookingId: string, revision: number, e: Evaluation) {
  return {
    bookingId,
    bookingRevision: revision,
    engineVersion: e.engineVersion,
    rateCardVersion: e.rateCardVersion,
    rulebookVersion: e.rulebookVersion,
    todayUk: e.todayUK,
    status: e.status,
    redCount: e.redCount,
    amberCount: e.amberCount,
    findings: e.rules,
    carrierSnapshot: e.carrier,
    missingFields: e.missingFields,
    inputIssues: e.inputIssues,
    result: e,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────
export async function getOwnedBooking(db: Exec, sessionId: string, bookingId: string): Promise<BookingRow | null> {
  const [row] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.sessionId, sessionId)))
    .limit(1);
  return row ?? null;
}

export async function loadBooking(db: Exec, sessionId: string, bookingId: string) {
  const row = await getOwnedBooking(db, sessionId, bookingId);
  if (!row) return null;
  const items = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, row.id)).orderBy(asc(bookingItems.position));
  return { row, items, draft: rowsToDraft(row, items) };
}

export async function latestEvaluation(db: Exec, bookingId: string, revision: number): Promise<Evaluation | null> {
  const [row] = await db
    .select({ result: evaluations.result })
    .from(evaluations)
    .where(and(eq(evaluations.bookingId, bookingId), eq(evaluations.bookingRevision, revision)))
    .limit(1);
  return (row?.result as Evaluation) ?? null;
}

export async function listRevisions(db: Exec, sessionId: string, bookingId: string, limit = 20) {
  const owned = await getOwnedBooking(db, sessionId, bookingId);
  if (!owned) return null;
  return db
    .select({
      revision: bookingRevisions.revision,
      source: bookingRevisions.source,
      changedFields: bookingRevisions.changedFields,
      createdAt: bookingRevisions.createdAt,
    })
    .from(bookingRevisions)
    .where(eq(bookingRevisions.bookingId, bookingId))
    .orderBy(desc(bookingRevisions.revision))
    .limit(limit);
}

// ─── Cursor helpers (newest activity first, stable on id) ─────────────────────
type ActivityCursor = { t: string; id: string };
export function encodeCursor(c: ActivityCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
export function decodeCursor(s: string | null | undefined): ActivityCursor | null {
  if (!s) return null;
  try {
    const c = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof c?.t === "string" && typeof c?.id === "string" && !Number.isNaN(Date.parse(c.t))) return c;
  } catch {
    /* ignore */
  }
  return null;
}

function activityBefore(c: ActivityCursor | null): SQL | undefined {
  if (!c) return undefined;
  const t = new Date(c.t);
  return or(lt(bookings.lastActivityAt, t), and(eq(bookings.lastActivityAt, t), lt(bookings.id, c.id)));
}

export type BookingListItem = {
  id: string;
  source: "chat" | "excel";
  title: string;
  externalBookingId: string | null;
  status: string;
  redCount: number;
  amberCount: number;
  revision: number;
  messageCount: number;
  importBatchId: string | null;
  sellerName: string | null;
  destinationCountry: string | null;
  lastActivityAt: string;
  createdAt: string;
};

const listColumns = {
  id: bookings.id,
  source: bookings.source,
  title: bookings.title,
  externalBookingId: bookings.externalBookingId,
  status: bookings.status,
  redCount: bookings.redCount,
  amberCount: bookings.amberCount,
  revision: bookings.revision,
  messageCount: bookings.messageCount,
  importBatchId: bookings.importBatchId,
  sellerName: bookings.sellerName,
  destinationCountry: bookings.destinationCountry,
  lastActivityAt: bookings.lastActivityAt,
  createdAt: bookings.createdAt,
};

function toListItem(r: { lastActivityAt: Date; createdAt: Date } & Omit<BookingListItem, "lastActivityAt" | "createdAt">): BookingListItem {
  return { ...r, lastActivityAt: r.lastActivityAt.toISOString(), createdAt: r.createdAt.toISOString() };
}

/** Previous chats: only chat-sourced threads that have at least one message. */
export async function listChats(db: Exec, sessionId: string, opts: { cursor?: string | null; limit: number }) {
  const rows = await db
    .select(listColumns)
    .from(bookings)
    .where(and(eq(bookings.sessionId, sessionId), eq(bookings.source, "chat"), gt(bookings.messageCount, 0), activityBefore(decodeCursor(opts.cursor))))
    .orderBy(desc(bookings.lastActivityAt), desc(bookings.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit).map(toListItem);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > opts.limit && last ? encodeCursor({ t: last.lastActivityAt, id: last.id }) : null };
}

/** All bookings (chat + Excel) for this session, with optional filters. */
export async function listBookings(
  db: Exec,
  sessionId: string,
  opts: { cursor?: string | null; limit: number; source?: "chat" | "excel" | null; status?: string | null; q?: string | null; batchId?: string | null },
) {
  const conds: (SQL | undefined)[] = [eq(bookings.sessionId, sessionId), activityBefore(decodeCursor(opts.cursor))];
  if (opts.source) conds.push(eq(bookings.source, opts.source));
  // Chat drafts with no messages are not real history yet.
  conds.push(or(eq(bookings.source, "excel"), gt(bookings.messageCount, 0), gt(bookings.revision, 0)));
  if (opts.status) conds.push(eq(bookings.status, opts.status));
  if (opts.batchId) conds.push(eq(bookings.importBatchId, opts.batchId));
  if (opts.q) {
    const like = `%${opts.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(bookings.title, like), ilike(bookings.sellerName, like), ilike(bookings.externalBookingId, like), ilike(bookings.destinationCountry, like)));
  }
  const rows = await db
    .select(listColumns)
    .from(bookings)
    .where(and(...conds))
    .orderBy(desc(bookings.lastActivityAt), desc(bookings.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit).map(toListItem);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > opts.limit && last ? encodeCursor({ t: last.lastActivityAt, id: last.id }) : null };
}

/**
 * Transcript page: the newest `limit` messages older than `before` (a seq cursor),
 * returned in chronological order. `nextCursor` loads earlier messages.
 */
export async function listMessages(db: Exec, sessionId: string, bookingId: string, opts: { before?: number | null; limit: number }) {
  const owned = await getOwnedBooking(db, sessionId, bookingId);
  if (!owned || owned.source !== "chat") throw new NotFoundError();
  const rows = await db
    .select({ id: chatMessages.id, seq: chatMessages.seq, role: chatMessages.role, content: chatMessages.content, revision: chatMessages.revision, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.bookingId, bookingId), eq(chatMessages.sessionId, sessionId), opts.before ? lt(chatMessages.seq, opts.before) : undefined))
    .orderBy(desc(chatMessages.seq))
    .limit(opts.limit + 1);
  const hasMore = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit).reverse();
  return {
    messages: page.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    nextCursor: hasMore && page.length ? String(page[0].seq) : null,
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────────
export type StoredMessage = { id: string; seq: number; role: "user" | "assistant" | "event"; content: string; revision: number | null; createdAt: string };

/** Idempotent creation of a chat-backed booking keyed by the client's create request id. */
export async function createChatBooking(db: Db, sessionId: string, createRequestId: string, draft: DraftBooking, evaluation: Evaluation) {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(bookings)
      .values({ sessionId, source: "chat", createRequestId, ...draftColumns(draft, evaluation), revision: 0 })
      .onConflictDoNothing({ target: [bookings.sessionId, bookings.createRequestId], where: sql`${bookings.createRequestId} is not null` })
      .returning({ id: bookings.id });
    if (!inserted.length) {
      const [existing] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.sessionId, sessionId), eq(bookings.createRequestId, createRequestId)))
        .limit(1);
      return { id: existing.id, created: false };
    }
    const id = inserted[0].id;
    await tx.insert(bookingRevisions).values({ bookingId: id, revision: 0, source: "create", changedFields: [], afterJson: draft });
    await tx.insert(evaluations).values(evaluationValues(id, 0, evaluation));
    return { id, created: true };
  });
}

export type CommitInput = {
  sessionId: string;
  bookingId: string;
  expectedRevision: number;
  requestId: string;
  kind: "chat" | "edit" | "confirm";
  before: DraftBooking;
  after: DraftBooking;
  patch: unknown;
  changedFields: string[];
  evaluation: Evaluation;
  messages: { role: "user" | "assistant" | "event"; content: string; meta?: unknown }[];
  confirm?: boolean;
  /** Builds the JSON stored for idempotent replay and returned to the client. */
  buildResponse: (revision: number, messages: StoredMessage[], tx: Exec) => unknown | Promise<unknown>;
  /** Test hook to simulate a failure mid-transaction. */
  failAfterUpdate?: boolean;
};

export type CommitResult = { replayed: boolean; response: unknown; revision: number };

/** Look up a previously completed request (idempotent replay) for an owned booking. */
export async function findCompletedRequest(db: Exec, sessionId: string, bookingId: string, requestId: string): Promise<unknown | null> {
  const [row] = await db
    .select({ response: chatTurnRequests.responseJson })
    .from(chatTurnRequests)
    .innerJoin(bookings, eq(bookings.id, chatTurnRequests.bookingId))
    .where(and(eq(chatTurnRequests.bookingId, bookingId), eq(chatTurnRequests.requestId, requestId), eq(bookings.sessionId, sessionId)))
    .limit(1);
  return row?.response ?? null;
}

/**
 * Atomically: idempotency record → compare-and-set revision → items → messages → revision event →
 * evaluation → stored response. Any failure rolls the whole turn back.
 */
export async function commitBookingChange(db: Db, input: CommitInput): Promise<CommitResult> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(chatTurnRequests)
      .values({ bookingId: input.bookingId, requestId: input.requestId, kind: input.kind, expectedRevision: input.expectedRevision })
      .onConflictDoNothing({ target: [chatTurnRequests.bookingId, chatTurnRequests.requestId] })
      .returning({ id: chatTurnRequests.id });
    if (!claimed.length) {
      const [prior] = await tx
        .select({ response: chatTurnRequests.responseJson, applied: chatTurnRequests.appliedRevision })
        .from(chatTurnRequests)
        .where(and(eq(chatTurnRequests.bookingId, input.bookingId), eq(chatTurnRequests.requestId, input.requestId)));
      return { replayed: true, response: prior.response, revision: prior.applied ?? input.expectedRevision };
    }

    const owned = await tx
      .select({ messageCount: bookings.messageCount, source: bookings.source })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.sessionId, input.sessionId)));
    if (!owned.length) throw new NotFoundError();
    const newMessages = owned[0].source === "chat" ? input.messages : input.messages.filter((m) => m.role !== "event");
    if (owned[0].messageCount + newMessages.length > MAX_MESSAGES_PER_THREAD)
      throw new LimitError(`This conversation reached the ${MAX_MESSAGES_PER_THREAD}-message limit. Use the Edit form or start a new chat.`);

    const now = new Date();
    const updated = await tx
      .update(bookings)
      .set({
        ...draftColumns(input.after, input.evaluation),
        revision: sql`${bookings.revision} + 1`,
        messageCount: sql`${bookings.messageCount} + ${newMessages.length}`,
        updatedAt: now,
        lastActivityAt: now,
        confirmedAt: input.confirm ? now : null,
        confirmedRevision: input.confirm ? input.expectedRevision + 1 : null,
      })
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.sessionId, input.sessionId), eq(bookings.revision, input.expectedRevision)))
      .returning({ revision: bookings.revision });
    if (!updated.length) {
      const [cur] = await tx.select({ revision: bookings.revision }).from(bookings).where(eq(bookings.id, input.bookingId));
      throw new ConflictError(cur?.revision ?? null);
    }
    const revision = updated[0].revision;
    if (input.failAfterUpdate) throw new Error("Simulated failure after booking update");

    // Items: delete removed lines, upsert the rest in order.
    const keepIds = input.after.items.map((i) => i.itemId);
    await tx
      .delete(bookingItems)
      .where(and(eq(bookingItems.bookingId, input.bookingId), keepIds.length ? sql`${bookingItems.id} not in (${sql.join(keepIds.map((id) => sql`${id}::uuid`), sql`, `)})` : undefined));
    if (input.after.items.length) {
      // One multi-row upsert; the WHERE keeps an id from ever moving between bookings.
      const res = await tx
        .insert(bookingItems)
        .values(input.after.items.map((item, pos) => itemValues(input.bookingId, item, pos)))
        .onConflictDoUpdate({
          target: bookingItems.id,
          set: {
            position: sql`excluded.position`,
            sku: sql`excluded.sku`,
            description: sql`excluded.description`,
            hsCode: sql`excluded.hs_code`,
            quantityUnits: sql`excluded.quantity_units`,
            unitPriceGbp: sql`excluded.unit_price_gbp`,
            unitsPerCarton: sql`excluded.units_per_carton`,
            cartons: sql`excluded.cartons`,
            unitWeightKg: sql`excluded.unit_weight_kg`,
            countryOfOrigin: sql`excluded.country_of_origin`,
            updatedAt: now,
          },
          setWhere: eq(bookingItems.bookingId, input.bookingId),
        })
        .returning({ id: bookingItems.id });
      if (res.length !== input.after.items.length) throw new Error("Item id collision");
    }

    let stored: StoredMessage[] = [];
    if (newMessages.length) {
      const rows = await tx
        .insert(chatMessages)
        .values(newMessages.map((m) => ({ bookingId: input.bookingId, sessionId: input.sessionId, role: m.role, content: m.content, requestId: input.requestId, revision, meta: m.meta ?? null, createdAt: now })))
        .returning({ id: chatMessages.id, seq: chatMessages.seq, role: chatMessages.role, content: chatMessages.content, revision: chatMessages.revision, createdAt: chatMessages.createdAt });
      stored = rows.sort((a, b) => a.seq - b.seq).map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));
    }

    await tx.insert(bookingRevisions).values({
      bookingId: input.bookingId,
      revision,
      source: input.kind,
      changePatch: input.patch,
      changedFields: input.changedFields,
      beforeJson: input.before,
      afterJson: input.after,
    });
    await tx.insert(evaluations).values(evaluationValues(input.bookingId, revision, input.evaluation));

    const response = await input.buildResponse(revision, stored, tx);
    await tx
      .update(chatTurnRequests)
      .set({ appliedRevision: revision, responseJson: response })
      .where(and(eq(chatTurnRequests.bookingId, input.bookingId), eq(chatTurnRequests.requestId, input.requestId)));
    return { replayed: false, response, revision };
  });
}

/** Deletes one owned chat thread (booking + items, messages, revisions, evaluations via FK cascade). */
export async function deleteChat(db: Db, sessionId: string, bookingId: string): Promise<boolean> {
  const deleted = await db
    .delete(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.sessionId, sessionId), eq(bookings.source, "chat")))
    .returning({ id: bookings.id });
  return deleted.length === 1;
}

// ─── Imports ──────────────────────────────────────────────────────────────────
export type ImportBookingInput = {
  draft: DraftBooking;
  evaluation: Evaluation;
  sourceRow: number | null;
  rawRow: unknown;
  itemRaw: Map<string, unknown>;
};

export async function persistImport(
  db: Db,
  sessionId: string,
  batch: { filename: string; bookingRowCount: number; itemRowCount: number; status: string; summary: unknown },
  records: ImportBookingInput[],
  issues: (InputIssue & { externalBookingId?: string | null })[],
) {
  return db.transaction(async (tx) => {
    const [b] = await tx
      .insert(importBatches)
      .values({ sessionId, originalFilenameSanitized: batch.filename, bookingRowCount: batch.bookingRowCount, itemRowCount: batch.itemRowCount, status: batch.status, summary: batch.summary })
      .returning({ id: importBatches.id, createdAt: importBatches.createdAt });
    const idByExternal = new Map<string, string>();
    const bookingRows: (typeof bookings.$inferInsert)[] = [];
    const itemRows: (typeof bookingItems.$inferInsert)[] = [];
    const revisionRows: (typeof bookingRevisions.$inferInsert)[] = [];
    const evaluationRows: (typeof evaluations.$inferInsert)[] = [];
    for (const [idx, r] of records.entries()) {
      // Ids generated here so the whole batch is written with a few multi-row INSERTs.
      const id = crypto.randomUUID();
      bookingRows.push({
        id,
        sessionId,
        importBatchId: b.id,
        source: "excel",
        ...draftColumns(r.draft, r.evaluation),
        revision: 0,
        sourceRow: r.sourceRow,
        rawRow: r.rawRow,
        createdAt: b.createdAt,
        updatedAt: b.createdAt,
        // Sheet order within a batch: row 1 sorts first under "newest activity first".
        lastActivityAt: new Date(b.createdAt.getTime() - idx),
      });
      if (r.draft.externalBookingId && !idByExternal.has(r.draft.externalBookingId)) idByExternal.set(r.draft.externalBookingId, id);
      r.draft.items.forEach((it, pos) => itemRows.push(itemValues(id, it, pos, r.itemRaw.get(it.itemId))));
      revisionRows.push({ bookingId: id, revision: 0, source: "import", changedFields: [], afterJson: r.draft });
      evaluationRows.push(evaluationValues(id, 0, r.evaluation));
    }
    const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
    for (const c of chunks(bookingRows, 250)) await tx.insert(bookings).values(c);
    for (const c of chunks(itemRows, 500)) await tx.insert(bookingItems).values(c);
    for (const c of chunks(revisionRows, 200)) await tx.insert(bookingRevisions).values(c);
    for (const c of chunks(evaluationRows, 100)) await tx.insert(evaluations).values(c);
    for (const part of chunks(issues, 500)) {
      await tx.insert(importIssues).values(
        part.map((i) => ({
          batchId: b.id,
          bookingId: i.externalBookingId ? idByExternal.get(i.externalBookingId) ?? null : null,
          sheet: i.sheet ?? "Workbook",
          sourceRow: i.row ?? null,
          columnName: i.column ?? null,
          issueCode: i.code,
          severity: i.severity,
          message: i.message,
          rawValue: i.rawValue ?? null,
        })),
      );
    }
    return { batchId: b.id, createdAt: b.createdAt.toISOString() };
  });
}

export async function getImportBatch(db: Exec, sessionId: string, batchId: string) {
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.sessionId, sessionId)))
    .limit(1);
  if (!batch) return null;
  const issues = await db.select().from(importIssues).where(eq(importIssues.batchId, batchId)).orderBy(asc(importIssues.sheet), asc(importIssues.sourceRow));
  return { batch, issues };
}

export async function listImportBatches(db: Exec, sessionId: string, limit = 20) {
  return db
    .select({
      id: importBatches.id,
      filename: importBatches.originalFilenameSanitized,
      bookingRowCount: importBatches.bookingRowCount,
      status: importBatches.status,
      summary: importBatches.summary,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .where(eq(importBatches.sessionId, sessionId))
    .orderBy(desc(importBatches.createdAt))
    .limit(limit);
}

export async function issuesForBooking(db: Exec, sessionId: string, bookingId: string) {
  const owned = await getOwnedBooking(db, sessionId, bookingId);
  if (!owned || !owned.importBatchId) return [];
  return db.select().from(importIssues).where(and(eq(importIssues.bookingId, bookingId), eq(importIssues.batchId, owned.importBatchId)));
}

export async function countOwned(db: Exec, sessionId: string, ids: string[]) {
  if (!ids.length) return 0;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.sessionId, sessionId), inArray(bookings.id, ids)));
  return r.n;
}
