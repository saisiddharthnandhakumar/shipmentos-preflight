import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import {
  ConflictError,
  commitBookingChange,
  createChatBooking,
  deleteChat,
  listChats,
  listMessages,
  loadBooking,
} from "@/lib/db/repo";
import { bookings, chatMessages, chatTurnRequests } from "@/lib/db/schema";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { emptyDraft, type DraftBooking } from "@/lib/domain/schemas";
import { createSession } from "@/lib/server/session";

afterAll(closeDb);
const TODAY = "2026-10-25";
const ev = (d: DraftBooking) => evaluateBooking(d, { todayUK: TODAY });

async function setup() {
  const db = getDb();
  const s = await createSession(db);
  const draft = { ...emptyDraft(), originCity: "Manchester" as const, pallets: 3 };
  const { id } = await createChatBooking(db, s.id, randomUUID(), draft, ev(draft));
  return { db, sessionId: s.id, bookingId: id, draft };
}

function change(base: { sessionId: string; bookingId: string; draft: DraftBooking }, expectedRevision: number, requestId: string, pallets: number, extra: Partial<Parameters<typeof commitBookingChange>[1]> = {}) {
  const after = { ...base.draft, pallets };
  return {
    sessionId: base.sessionId,
    bookingId: base.bookingId,
    expectedRevision,
    requestId,
    kind: "chat" as const,
    before: base.draft,
    after,
    patch: { operations: [{ op: "increment", field: "pallets", by: 1 }] },
    changedFields: ["pallets"],
    evaluation: ev(after),
    messages: [
      { role: "user" as const, content: "add one pallet" },
      { role: "assistant" as const, content: `pallets now ${pallets}` },
    ],
    buildResponse: (revision: number, messages: unknown[]) => ({ revision, pallets, messages }),
    ...extra,
  };
}

describe("atomic, version-guarded booking writes", () => {
  it("creation is idempotent per create request id", async () => {
    const db = getDb();
    const s = await createSession(db);
    const key = randomUUID();
    const d = emptyDraft();
    const a = await createChatBooking(db, s.id, key, d, ev(d));
    const b = await createChatBooking(db, s.id, key, d, ev(d));
    expect(b).toEqual({ id: a.id, created: false });
  });

  it("commits booking, messages, revision and evaluation together", async () => {
    const base = await setup();
    const r = await commitBookingChange(base.db, change(base, 0, "req-1", 4));
    expect(r.replayed).toBe(false);
    expect(r.revision).toBe(1);
    const loaded = await loadBooking(base.db, base.sessionId, base.bookingId);
    expect(loaded!.draft.pallets).toBe(4);
    expect(loaded!.row.messageCount).toBe(2);
    const counts = await base.db.execute(sql`select
      (select count(*)::int from booking_revisions where booking_id = ${base.bookingId}) as revisions,
      (select count(*)::int from evaluations where booking_id = ${base.bookingId} and booking_revision = 1) as evals`);
    expect(counts.rows[0]).toEqual({ revisions: 2, evals: 1 });
  });

  it("stale expectedRevision → ConflictError (HTTP 409 at the API) and no partial write", async () => {
    const base = await setup();
    await commitBookingChange(base.db, change(base, 0, "a", 4));
    await expect(commitBookingChange(base.db, change(base, 0, "b", 9))).rejects.toBeInstanceOf(ConflictError);
    const loaded = await loadBooking(base.db, base.sessionId, base.bookingId);
    expect(loaded!.draft.pallets).toBe(4);
    const turns = await base.db.select().from(chatTurnRequests).where(eq(chatTurnRequests.bookingId, base.bookingId));
    expect(turns.map((t) => t.requestId)).toEqual(["a"]);
  });

  it("duplicate requestId replays the original response and applies once", async () => {
    const base = await setup();
    const first = await commitBookingChange(base.db, change(base, 0, "same", 4));
    const retry = await commitBookingChange(base.db, change(base, 0, "same", 4));
    expect(retry.replayed).toBe(true);
    expect(retry.response).toEqual(first.response);
    const loaded = await loadBooking(base.db, base.sessionId, base.bookingId);
    expect(loaded!.row.revision).toBe(1);
    expect(loaded!.row.messageCount).toBe(2);
  });

  it("two concurrent edits on the same revision: exactly one wins", async () => {
    const base = await setup();
    const results = await Promise.allSettled([
      commitBookingChange(base.db, change(base, 0, "c1", 4)),
      commitBookingChange(base.db, change(base, 0, "c2", 5)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect((await loadBooking(base.db, base.sessionId, base.bookingId))!.row.revision).toBe(1);
  });

  it("a failure mid-transaction rolls back everything", async () => {
    const base = await setup();
    await expect(commitBookingChange(base.db, change(base, 0, "boom", 4, { failAfterUpdate: true }))).rejects.toThrow(/Simulated failure/);
    const loaded = await loadBooking(base.db, base.sessionId, base.bookingId);
    expect(loaded!.row.revision).toBe(0);
    expect(loaded!.draft.pallets).toBe(3);
    const msgs = await base.db.select().from(chatMessages).where(eq(chatMessages.bookingId, base.bookingId));
    expect(msgs).toHaveLength(0);
    const turns = await base.db.select().from(chatTurnRequests).where(and(eq(chatTurnRequests.bookingId, base.bookingId), eq(chatTurnRequests.requestId, "boom")));
    expect(turns).toHaveLength(0);
    // The same request can be retried successfully afterwards.
    expect((await commitBookingChange(base.db, change(base, 0, "boom", 4))).revision).toBe(1);
  });
});

describe("session ownership", () => {
  it("another session cannot load, list, page messages of, or delete a booking it doesn't own", async () => {
    const a = await setup();
    await commitBookingChange(a.db, change(a, 0, "x", 4));
    const other = await createSession(a.db);
    expect(await loadBooking(a.db, other.id, a.bookingId)).toBeNull();
    expect((await listChats(a.db, other.id, { limit: 50 })).items).toEqual([]);
    await expect(listMessages(a.db, other.id, a.bookingId, { limit: 50 })).rejects.toThrow();
    expect(await deleteChat(a.db, other.id, a.bookingId)).toBe(false);
    expect(await loadBooking(a.db, a.sessionId, a.bookingId)).not.toBeNull();
    const [row] = await a.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, a.bookingId));
    expect(row.id).toBe(a.bookingId);
  });

  it("owner can list and delete; delete cascades messages", async () => {
    const a = await setup();
    await commitBookingChange(a.db, change(a, 0, "x", 4));
    expect((await listChats(a.db, a.sessionId, { limit: 50 })).items.map((c) => c.id)).toEqual([a.bookingId]);
    expect((await listMessages(a.db, a.sessionId, a.bookingId, { limit: 50 })).messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await deleteChat(a.db, a.sessionId, a.bookingId)).toBe(true);
    expect(await a.db.select().from(chatMessages).where(eq(chatMessages.bookingId, a.bookingId))).toHaveLength(0);
  });
});
