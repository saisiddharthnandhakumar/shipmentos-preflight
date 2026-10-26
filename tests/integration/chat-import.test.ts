import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { POST as bookingsPost } from "@/app/api/bookings/route";
import { POST as importPost } from "@/app/api/chats/[bookingId]/import/route";
import { closeDb } from "@/lib/db/client";
import { json, req, type Jar } from "../helpers/http";
import { newSession } from "../helpers/session";

afterAll(closeDb);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (bookingId: string) => ({ params: Promise.resolve({ bookingId }) }) as any;

async function newChat(jar: Jar) {
  return (await json(await bookingsPost(req("/api/bookings", { method: "POST", jar, body: { clientKey: `imp${Math.random().toString(36).slice(2)}abcd` } })))).bookingId as string;
}
function importReq(jar: Jar, id: string, fixture: string, expectedRevision: number, over: { name?: string; requestId?: string } = {}) {
  const form = new FormData();
  form.append("file", new File([readFileSync(`tests/fixtures/${fixture}`)], over.name ?? fixture));
  form.append("expectedRevision", String(expectedRevision));
  form.append("requestId", over.requestId ?? `rq${Math.random().toString(36).slice(2)}abcd`);
  return req(`/api/chats/${id}/import`, { method: "POST", jar, rawBody: form });
}

describe("POST /api/chats/[bookingId]/import", () => {
  it("reads a one-booking file into the chat and summarises what is found and what is missing", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    const res = await importPost(importReq(jar, id, "single-incomplete.xlsx", 0), ctx(id));
    expect(res.status).toBe(200);
    const r = await json(res);
    expect(r.kind).toBe("booking");
    expect(r.snapshot.draft).toMatchObject({ originCity: "Manchester", destinationCity: "Frankfurt", destinationType: "Warehouse", pallets: 3, sellerName: null, readyToShipDate: null });
    expect(r.snapshot.draft.items).toHaveLength(1);
    expect(r.snapshot.revisions.some((v: { source: string }) => v.source === "import")).toBe(true);
    const [user, assistant] = r.messages;
    expect(user).toMatchObject({ role: "user", content: "Uploaded single-incomplete.xlsx" });
    expect(assistant.content).toContain("I've read single-incomplete.xlsx");
    expect(assistant.content).toContain("Found:");
    expect(assistant.content).toContain("Manchester → Frankfurt (Warehouse)");
    expect(assistant.content).toContain("Still missing:");
    expect(assistant.content).toContain("seller name");
    expect(assistant.content).toContain("Flagged by the checks (1 to fix, 1 to check):");
    expect(assistant.content).toContain("R-01");
    expect(assistant.content).toContain("MUG-01");
    expect(assistant.content).toMatch(/What business is sending this\?/);
    expect(assistant.content).not.toContain("All details are in");
    expect(assistant.content).not.toContain("were replaced");
  });

  it("a second file replaces the first and says so; retrying the same request is idempotent", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    const first = await json(await importPost(importReq(jar, id, "single-incomplete.xlsx", 0), ctx(id)));
    const requestId = "replace-request-0001";
    const second = await json(await importPost(importReq(jar, id, "single-incomplete.xlsx", first.revision, { requestId, name: "again.xlsx" }), ctx(id)));
    expect(second.messages[1].content).toContain("The earlier details in this chat were replaced.");
    expect(second.snapshot.draft.items).toHaveLength(1);
    const replay = await json(await importPost(importReq(jar, id, "single-incomplete.xlsx", first.revision, { requestId }), ctx(id)));
    expect(replay.replayed).toBe(true);
    expect(replay.revision).toBe(second.revision);
  });

  it("a file with several bookings becomes an upload batch and leaves the chat untouched", async () => {
    const jar = await newSession();
    const id = await newChat(jar);
    const r = await json(await importPost(importReq(jar, id, "clean.xlsx", 0), ctx(id)));
    expect(r).toMatchObject({ kind: "batch", total: 3 });
    expect(r.batchId).toMatch(/^[0-9a-f-]{36}$/);
    const again = await json(await importPost(importReq(jar, id, "single-incomplete.xlsx", 0), ctx(id)));
    expect(again.revision).toBe(1); // the chat was still at revision 0
  });

  it("rejects stale revisions, other sessions, bad files and cross-origin posts", async () => {
    const jar = await newSession();
    const other = await newSession();
    const id = await newChat(jar);
    await importPost(importReq(jar, id, "single-incomplete.xlsx", 0), ctx(id));
    expect((await importPost(importReq(jar, id, "single-incomplete.xlsx", 0), ctx(id))).status).toBe(409);
    expect((await importPost(importReq(other, id, "single-incomplete.xlsx", 0), ctx(id))).status).toBe(404);
    expect((await importPost(importReq(jar, id, "single-incomplete.xlsx", 1, { name: "notes.txt" }), ctx(id))).status).toBe(400);
    const cross = importReq(jar, id, "single-incomplete.xlsx", 1);
    cross.headers.set("origin", "https://evil.example");
    expect((await importPost(cross, ctx(id))).status).toBe(403);
  });
});
