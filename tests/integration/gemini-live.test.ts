import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { POST as chatPost } from "@/app/api/chat/route";
import { POST as bookingsPost } from "@/app/api/bookings/route";
import { POST as transcribePost } from "@/app/api/transcribe/route";
import { POST as filterPost } from "@/app/api/imports/[id]/filter/route";
import { upload } from "../helpers/upload";
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
    const dense = await send(
      "We're Northfield Goods. SKU MUG-01: 1080 mugs, 90 cartons of 12, £5 each, 0.5 kg each, HS 691200, made in the UK. Gross weight 620 kg, declared value £5,400, 90 cartons in total. Appointment is booked.",
      1,
    );
    expect(dense.snapshot.evaluation.missingFields.map((m: { key: string }) => m.key)).toEqual([]);
    expect(dense.snapshot.evaluation.status).toBe("Ready to submit");
    const b = await send("Actually add one more pallet", 2);
    expect(b.snapshot.draft.pallets).toBe(4);
    expect(b.snapshot.evaluation.carrier.candidates.find((c: { option: { key: string } }) => c.option.key === "GB-DE-A").totalCostGBP).toBe(720);
  }, 90_000);
});

describe.skipIf(!live)("live Gemini: speech to text and chat-over-upload", () => {
  it("transcribes a spoken shipment description (WebM/Opus, as browsers record it)", async () => {
    const jar = await newSession();
    const res = await transcribePost(req("/api/transcribe", { method: "POST", jar, rawBody: new Uint8Array(readFileSync("tests/fixtures/speech.webm")), headers: { "content-type": "audio/webm;codecs=opus" } }));
    expect(res.status).toBe(200);
    const { text } = await json(res);
    expect(text).toMatch(/pallets/i);
    expect(text).toMatch(/Manchester/i);
    expect(text).toMatch(/Frankfurt/i);
  }, 60_000);

  it("turns 'Germany only, rows 1 to 7' into a filter, then refines it", async () => {
    const jar = await newSession();
    const { body } = await upload(jar, "planted-errors.xlsx");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ask = async (message: string, current: object) => json(await filterPost(req(`/api/imports/${body.batchId}/filter`, { method: "POST", jar, body: { message, current } }), { params: Promise.resolve({ id: body.batchId }) } as any));
    const a = await ask("give me the shipments going from Great Britain to Germany, rows 1 to 7", {});
    expect(a.filter).toEqual({ destinationCountries: ["Germany"], rowFrom: 1, rowTo: 7 });
    const b = await ask("only the blocked ones", a.filter);
    expect(b.filter).toEqual({ destinationCountries: ["Germany"], rowFrom: 1, rowTo: 7, statuses: ["Blocked"] });
    const c = await ask("show everything again", b.filter);
    expect(c.filter).toEqual({});
  }, 90_000);
});
