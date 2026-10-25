import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { POST as chatPost } from "@/app/api/chat/route";
import { DELETE as chatDelete } from "@/app/api/chats/[bookingId]/route";
import { GET as messagesGet } from "@/app/api/chats/[bookingId]/messages/route";
import { GET as chatsGet } from "@/app/api/chats/route";
import { GET as bookingsGet, POST as bookingsPost } from "@/app/api/bookings/route";
import { GET as bookingGet, PATCH as bookingPatch } from "@/app/api/bookings/[id]/route";
import { POST as confirmPost } from "@/app/api/bookings/[id]/confirm/route";
import { ExtractionError, setExtractorForTests, type Extractor } from "@/lib/ai/extract";
import { closeDb, getDb } from "@/lib/db/client";
import { parseModelOutput } from "@/lib/ai/extract";
import { fakeExtractor } from "@/lib/ai/fake-extractor";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { json, req, type Jar } from "../helpers/http";
import { newSession } from "../helpers/session";
import { upload } from "../helpers/upload";

afterAll(async () => {
  setExtractorForTests(null);
  await closeDb();
});
afterEach(() => {
  setExtractorForTests(fakeExtractor);
  resetRateLimits();
  vi.restoreAllMocks();
});
setExtractorForTests(fakeExtractor);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as any;
let n = 0;
const rid = () => `req${Date.now()}${++n}abcdef`;

async function newChat(jar: Jar) {
  const r = await bookingsPost(req("/api/bookings", { method: "POST", jar, body: { clientKey: rid() } }));
  return (await json(r)).bookingId as string;
}
async function say(jar: Jar, bookingId: string, message: string, expectedRevision: number, requestId = rid()) {
  const r = await chatPost(req("/api/chat", { method: "POST", jar, body: { bookingId, expectedRevision, requestId, message } }));
  return { status: r.status, body: await json(r) };
}

const OPENING = "I need 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready 5 Nov. Cheapest please.";
const DETAILS =
  "Seller is Northfield Goods. SKU MUG-01, 1080 mugs, 12 units each, 90 cartons, £5 each, 0.5 kg each, HS 691200, made in United Kingdom. Gross weight 620 kg, declared £5400, 90 cartons in total. I have booked the appointment.";

describe("chat turns", () => {
  it("opening message: extracts facts, asks only for missing ones (never pallets/route)", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    const { status, body } = await say(jar, id, OPENING, 0);
    expect(status).toBe(200);
    const d = body.snapshot.draft;
    expect([d.pallets, d.originCity, d.destinationCity, d.destinationCountry, d.destinationType, d.sellerPriority]).toEqual([3, "Manchester", "Frankfurt", "Germany", "Warehouse", "Cheapest"]);
    expect(d.readyToShipDate).toMatch(/-11-05$/);
    expect(d.sellerName).toBeNull();
    expect(d.totalGrossWeightKg).toBeNull();
    const reply = body.messages.find((m: { role: string }) => m.role === "assistant").content as string;
    expect(reply).toMatch(/What business is sending this\?/);
    expect(reply).not.toMatch(/how many pallets/i);
    expect(body.snapshot.evaluation.status).toBe("Draft");
    expect(body.revision).toBe(1);
  });

  it("completes the booking, then 'add one more pallet' is applied exactly once even when retried", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    await say(jar, id, OPENING, 0);
    const done = await say(jar, id, DETAILS, 1);
    expect(done.body.snapshot.evaluation.status).toBe("Ready to submit");
    const a = done.body.snapshot.evaluation.carrier.candidates.find((c: { option: { key: string } }) => c.option.key === "GB-DE-A");
    expect(a.totalCostGBP).toBe(540);

    const requestId = rid();
    const first = await say(jar, id, "Actually, add one more pallet.", 2, requestId);
    expect(first.body.snapshot.draft.pallets).toBe(4);
    expect(first.body.revision).toBe(3);
    expect(first.body.snapshot.evaluation.carrier.kgPerPallet).toBe(155);
    const cost = first.body.snapshot.evaluation.carrier.candidates.find((c: { option: { key: string } }) => c.option.key === "GB-DE-A").totalCostGBP;
    expect(cost).toBe(720);
    expect(first.body.messages[1].content).toMatch(/pallets 3 → 4/);

    // HTTP client retries the identical request: same response, no second increment.
    const retry = await say(jar, id, "Actually, add one more pallet.", 2, requestId);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.revision).toBe(3);
    expect(retry.body.messages.map((m: { id: string }) => m.id)).toEqual(first.body.messages.map((m: { id: string }) => m.id));
    const snap = await json(await bookingGet(req(`/api/bookings/${id}`, { jar }), ctx({ id })));
    expect(snap.draft.pallets).toBe(4);
    expect(snap.booking.revision).toBe(3);
    expect(snap.revisions.filter((r: { changedFields: string[] }) => r.changedFields.includes("pallets"))).toHaveLength(2); // set 3, then 3→4

    // Transcript has each message once, in order.
    const t = await json(await messagesGet(req(`/api/chats/${id}/messages?limit=50`, { jar }), ctx({ bookingId: id })));
    expect(t.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(t.messages[4].content).toBe("Actually, add one more pallet.");
  });

  it("stale expectedRevision returns 409 with the latest snapshot and changes nothing", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    await say(jar, id, OPENING, 0);
    const stale = await say(jar, id, "add one more pallet", 0);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_REVISION");
    expect(stale.body.error.details.snapshot.draft.pallets).toBe(3);
    const snap = await json(await bookingGet(req(`/api/bookings/${id}`, { jar }), ctx({ id })));
    expect(snap.draft.pallets).toBe(3);
    expect(snap.booking.revision).toBe(1);
  });

  it("France instead, Paris: country and city update together and rates recompute", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    await say(jar, id, OPENING, 0);
    await say(jar, id, DETAILS, 1);
    const r = await say(jar, id, "Make it France instead, Paris.", 2);
    expect([r.body.snapshot.draft.destinationCountry, r.body.snapshot.draft.destinationCity]).toEqual(["France", "Paris"]);
    expect(r.body.snapshot.evaluation.carrier.recommendedKey).toBe("GB-FR-A");
    expect(r.body.snapshot.evaluation.carrier.candidates[0].totalCostGBP).toBe(510);
  });

  it("AI failure returns a recoverable error and persists nothing; malformed model JSON is rejected by Zod", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    const failing: Extractor = async () => {
      throw new ExtractionError("The AI assistant is unavailable right now.", "unavailable");
    };
    setExtractorForTests(failing);
    const r = await say(jar, id, OPENING, 0);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("AI_UNAVAILABLE");
    const snap = await json(await bookingGet(req(`/api/bookings/${id}`, { jar }), ctx({ id })));
    expect(snap.booking.revision).toBe(0);
    expect(snap.booking.messageCount).toBe(0);
    expect(parseModelOutput('{"operations":[{"op":"set","field":"status","value":"Ready"}]}').ok).toBe(false);
    expect(parseModelOutput("not json").ok).toBe(false);
    expect(parseModelOutput('{"operations":[{"op":"increment","field":"pallets","by":1,"value":null,"target":null}]}').ok).toBe(true);
  });

  it("database outage: 503 'Unable to save', nothing claimed as saved", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    const db = getDb();
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    const r = await say(jar, id, OPENING, 0);
    expect(spy).toHaveBeenCalled();
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("DB_UNAVAILABLE");
    expect(r.body.error.message).toMatch(/Unable to save/);
    const snap = await json(await bookingGet(req(`/api/bookings/${id}`, { jar }), ctx({ id })));
    expect(snap.booking.revision).toBe(0);
  });

  it("direct edit uses the same version-safe path; confirm saves an honest ready-to-submit draft", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    await say(jar, id, OPENING, 0);
    await say(jar, id, DETAILS, 1);
    const edit = await bookingPatch(
      req(`/api/bookings/${id}`, { method: "PATCH", jar, body: { expectedRevision: 2, requestId: rid(), operations: [{ op: "set", field: "deliveryAppointmentBooked", value: false }] } }),
      ctx({ id }),
    );
    const e = await json(edit);
    expect(e.snapshot.evaluation.status).toBe("Needs attention");
    expect(e.messages[0].role).toBe("event");
    const conf = await json(await confirmPost(req(`/api/bookings/${id}/confirm`, { method: "POST", jar, body: { expectedRevision: 3, requestId: rid() } }), ctx({ id })));
    expect(conf.snapshot.booking.confirmedRevision).toBe(4);
    expect(conf.messages[0].content).toMatch(/ready-to-submit draft \(SOS-/);
    expect(conf.messages[0].content).toMatch(/no carrier has been contacted|Needs attention/);
  });
});

describe("previous chats, history and deletion", () => {
  it("two independent chats: list order, isolation, reopen transcript, continue the first", async () => {
    const jar = await newSession();
    const first = await newChat(jar);
    await say(jar, first, OPENING, 0);
    const second = await newChat(jar);
    await say(jar, second, "Sending 2 pallets of cotton t-shirts from London to a shop in Paris, as fast as possible.", 0);

    let list = await json(await chatsGet(req("/api/chats", { jar })));
    expect(list.items.map((c: { id: string }) => c.id)).toEqual([second, first]);
    expect(list.items.map((c: { title: string }) => c.title)).toEqual(["London → Paris", "Manchester → Frankfurt"]);

    // Reopen the first: its own transcript and facts, not the second's.
    const t = await json(await messagesGet(req(`/api/chats/${first}/messages`, { jar }), ctx({ bookingId: first })));
    expect(t.messages[0].content).toBe(OPENING);
    const s1 = await json(await bookingGet(req(`/api/bookings/${first}`, { jar }), ctx({ id: first })));
    expect(s1.draft.pallets).toBe(3);

    // Continue the first chat; the second is untouched; ordering updates.
    await say(jar, first, "add one more pallet", s1.booking.revision);
    const s1b = await json(await bookingGet(req(`/api/bookings/${first}`, { jar }), ctx({ id: first })));
    const s2 = await json(await bookingGet(req(`/api/bookings/${second}`, { jar }), ctx({ id: second })));
    expect([s1b.draft.pallets, s2.draft.pallets]).toEqual([4, 2]);
    list = await json(await chatsGet(req("/api/chats", { jar })));
    expect(list.items[0].id).toBe(first);
  });

  it("empty chats are not listed; pagination of chats and messages is stable", async () => {
    const jar = await newSession();
    await newChat(jar); // never messaged
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await newChat(jar);
      await say(jar, id, `${i + 2} pallets from Leeds to Berlin`, 0);
      ids.push(id);
    }
    const p1 = await json(await chatsGet(req("/api/chats?limit=2", { jar })));
    expect(p1.items.every((c: { messageCount: number }) => c.messageCount > 0)).toBe(true);
    expect(p1.items).toHaveLength(2);
    const p2 = await json(await chatsGet(req(`/api/chats?limit=2&cursor=${p1.nextCursor}`, { jar })));
    expect([...p1.items, ...p2.items].map((c: { id: string }) => c.id)).toEqual([...ids].reverse());
    expect(p2.nextCursor).toBeNull();

    // Message pagination: newest page first, cursor walks back in chronological order.
    const id = ids[0];
    for (let i = 0; i < 2; i++) {
      const snap = await json(await bookingGet(req(`/api/bookings/${id}`, { jar }), ctx({ id })));
      await say(jar, id, "add one more pallet", snap.booking.revision);
    }
    const m1 = await json(await messagesGet(req(`/api/chats/${id}/messages?limit=4`, { jar }), ctx({ bookingId: id })));
    const m2 = await json(await messagesGet(req(`/api/chats/${id}/messages?limit=4&cursor=${m1.nextCursor}`, { jar }), ctx({ bookingId: id })));
    const all = [...m2.messages, ...m1.messages];
    expect(all).toHaveLength(6);
    expect(all[0].content).toBe("2 pallets from Leeds to Berlin");
    expect(all.map((m: { seq: number }) => m.seq)).toEqual([...all.map((m: { seq: number }) => m.seq)].sort((a, b) => a - b));
  }, 180_000);

  it("all-bookings shows chat + Excel; previous chats shows only chats; deleting a chat keeps imports", async () => {
    const jar = await newSession();
    const chat = await newChat(jar);
    await say(jar, chat, OPENING, 0);
    const keep = await newChat(jar);
    await say(jar, keep, "2 pallets from Leeds to Berlin", 0);
    await upload(jar, "clean.xlsx");

    const all = await json(await bookingsGet(req("/api/bookings", { jar })));
    expect(all.items.filter((b: { source: string }) => b.source === "excel")).toHaveLength(3);
    expect(all.items.filter((b: { source: string }) => b.source === "chat")).toHaveLength(2);
    expect((await json(await chatsGet(req("/api/chats", { jar })))).items).toHaveLength(2);

    const del = await chatDelete(req(`/api/chats/${chat}`, { method: "DELETE", jar }), ctx({ bookingId: chat }));
    expect(del.status).toBe(200);
    expect((await bookingGet(req(`/api/bookings/${chat}`, { jar }), ctx({ id: chat }))).status).toBe(404);
    expect((await messagesGet(req(`/api/chats/${chat}/messages`, { jar }), ctx({ bookingId: chat }))).status).toBe(404);
    const after = await json(await bookingsGet(req("/api/bookings", { jar })));
    expect(after.items.map((b: { id: string }) => b.id)).not.toContain(chat);
    expect(after.items.filter((b: { source: string }) => b.source === "excel")).toHaveLength(3);
    expect(after.items.map((b: { id: string }) => b.id)).toContain(keep);
    // Excel bookings can't be deleted through the chat endpoint.
    const excelId = after.items.find((b: { source: string }) => b.source === "excel").id;
    expect((await chatDelete(req(`/api/chats/${excelId}`, { method: "DELETE", jar }), ctx({ bookingId: excelId }))).status).toBe(404);
  });

  it("another session can't list, read, page, continue or delete someone else's chat", async () => {
    const a = await newSession();
    const b = await newSession();
    const id = await newChat(a);
    await say(a, id, OPENING, 0);
    expect((await json(await chatsGet(req("/api/chats", { jar: b })))).items).toEqual([]);
    expect((await bookingGet(req(`/api/bookings/${id}`, { jar: b }), ctx({ id }))).status).toBe(404);
    expect((await messagesGet(req(`/api/chats/${id}/messages`, { jar: b }), ctx({ bookingId: id }))).status).toBe(404);
    expect((await say(b, id, "add one more pallet", 1)).status).toBe(404);
    expect((await chatDelete(req(`/api/chats/${id}`, { method: "DELETE", jar: b }), ctx({ bookingId: id }))).status).toBe(404);
    const snap = await json(await bookingGet(req(`/api/bookings/${id}`, { jar: a }), ctx({ id })));
    expect(snap.draft.pallets).toBe(3);
    // No cookie at all → 401, never data.
    expect((await chatsGet(req("/api/chats"))).status).toBe(401);
    // Writes need a same-site Origin.
    const noOrigin = await chatPost(req("/api/chat", { method: "POST", jar: a, origin: null, body: { bookingId: id, expectedRevision: 1, requestId: rid(), message: "hi" } }));
    expect(noOrigin.status).toBe(403);
  });

  it("validates input bounds", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    expect((await say(jar, id, "x".repeat(2001), 0)).status).toBe(400);
    expect((await say(jar, id, "   ", 0)).status).toBe(400);
    const bad = await chatPost(req("/api/chat", { method: "POST", jar, body: { bookingId: "not-a-uuid", expectedRevision: 0, requestId: rid(), message: "hi" } }));
    expect(bad.status).toBe(400);
  });
});
