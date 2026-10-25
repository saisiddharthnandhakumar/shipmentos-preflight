import { afterAll, describe, expect, it } from "vitest";
import { POST as chatPost } from "@/app/api/chat/route";
import { POST as bookingsPost } from "@/app/api/bookings/route";
import { setExtractorForTests } from "@/lib/ai/extract";
import { closeDb } from "@/lib/db/client";
import { json, req } from "../helpers/http";
import { newSession } from "../helpers/session";

// Opt-in: calls the real Gemini API. RUN_LIVE_AI=1 npx vitest run tests/integration/gemini-live.test.ts
const live = process.env.RUN_LIVE_AI === "1" && Boolean(process.env.GEMINI_API_KEY);

afterAll(closeDb);

describe.skipIf(!live)("live Gemini through POST /api/chat", () => {
  it("opening message then '+1 pallet' via the real model", async () => {
    setExtractorForTests(null);
    const jar = await newSession();
    const id = (await json(await bookingsPost(req("/api/bookings", { method: "POST", jar, body: { clientKey: `live${Date.now()}abcd` } })))).bookingId;
    const send = async (message: string, expectedRevision: number) =>
      json(await chatPost(req("/api/chat", { method: "POST", jar, body: { bookingId: id, expectedRevision, requestId: `live${Date.now()}${expectedRevision}xx`, message } })));
    const a = await send("I need 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready 5 Nov. Cheapest please.", 0);
    expect(a.snapshot.draft).toMatchObject({ pallets: 3, originCity: "Manchester", destinationCity: "Frankfurt", destinationType: "Warehouse", sellerPriority: "Cheapest" });
    expect(a.snapshot.draft.sellerName).toBeNull();
    const b = await send("Actually add one more pallet", 1);
    expect(b.snapshot.draft.pallets).toBe(4);
  }, 90_000);
});
