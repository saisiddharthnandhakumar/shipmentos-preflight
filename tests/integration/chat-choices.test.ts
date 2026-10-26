import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as bookingsPost } from "@/app/api/bookings/route";
import { POST as chatPost } from "@/app/api/chat/route";
import { setExtractorForTests } from "@/lib/ai/extract";
import { closeDb } from "@/lib/db/client";
import { json, req } from "../helpers/http";
import { newSession } from "../helpers/session";

afterAll(closeDb);
afterEach(() => setExtractorForTests(null));

describe("POST /api/chat with tapped-answer operations", () => {
  it("applies the operations without calling the AI, shows the tap as the seller's message, and asks the next question", async () => {
    setExtractorForTests(async () => {
      throw new Error("the extractor must not run for a tapped answer");
    });
    const jar = await newSession();
    const id = (await json(await bookingsPost(req("/api/bookings", { method: "POST", jar, body: { clientKey: `tap${Date.now()}abcd` } })))).bookingId;
    const tap = async (message: string, expectedRevision: number, operations: unknown) =>
      chatPost(req("/api/chat", { method: "POST", jar, body: { bookingId: id, expectedRevision, requestId: `tap${expectedRevision}${Date.now()}xx`, message, operations } }));

    const a = await json(await tap("Collecting from Manchester", 0, [{ op: "set", field: "originCity", value: "Manchester" }]));
    expect(a.snapshot.draft.originCity).toBe("Manchester");
    expect(a.messages[0]).toMatchObject({ role: "user", content: "Collecting from Manchester" });
    expect(a.messages[1].content).toMatch(/Got it — from: Manchester/);
    expect(a.messages[1].content).toMatch(/Where is it going/);

    const b = await json(await tap("Delivering to Frankfurt", 1, [{ op: "set", field: "destinationCity", value: "Frankfurt" }]));
    expect(b.snapshot.draft).toMatchObject({ destinationCity: "Frankfurt", destinationCountry: "Germany" });

    const bad = await tap("x", 2, [{ op: "set", field: "notAField", value: 1 }]);
    expect(bad.status).toBe(400);
    expect((await tap("x", 2, [])).status).toBe(400);
  });
});
