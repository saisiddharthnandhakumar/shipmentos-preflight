import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as transcribePost } from "@/app/api/transcribe/route";
import { POST as filterPost } from "@/app/api/imports/[id]/filter/route";
import { setFilterExtractorForTests, type FilterInput } from "@/lib/ai/filter-extract";
import { AiError } from "@/lib/ai/gemini-client";
import { setTranscriberForTests } from "@/lib/ai/transcribe";
import { closeDb } from "@/lib/db/client";
import { json, req, type Jar } from "../helpers/http";
import { newSession } from "../helpers/session";
import { upload } from "../helpers/upload";

afterAll(closeDb);
afterEach(() => {
  setTranscriberForTests(null);
  setFilterExtractorForTests(null);
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const audio = (bytes: number, type = "audio/webm;codecs=opus", jar?: Jar) => req("/api/transcribe", { method: "POST", jar, rawBody: new Uint8Array(bytes), headers: { "content-type": type } });

describe("POST /api/transcribe", () => {
  it("returns the transcript for a recording and passes the normalised mime type", async () => {
    const jar = await newSession();
    let seen: { size: number; mimeType: string } | null = null;
    setTranscriberForTests(async ({ data, mimeType }) => ((seen = { size: data.length, mimeType }), "3 pallets to Frankfurt"));
    const res = await transcribePost(audio(5000, undefined, jar));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ text: "3 pallets to Frankfurt" });
    expect(seen).toEqual({ size: 5000, mimeType: "audio/webm" });
  });

  it("rejects cross-origin, session-less, non-audio and oversized requests", async () => {
    const jar = await newSession();
    setTranscriberForTests(async () => "x");
    expect((await transcribePost(req("/api/transcribe", { method: "POST", rawBody: new Uint8Array(5000), headers: { "content-type": "audio/webm" }, origin: "https://evil.example" }))).status).toBe(403);
    expect((await transcribePost(audio(5000))).status).toBe(401);
    expect((await transcribePost(audio(5000, "text/plain", jar))).status).toBe(415);
    expect((await transcribePost(audio(4_100_000, undefined, jar))).status).toBe(413);
  });

  it("a near-empty recording returns no text without calling the model", async () => {
    const jar = await newSession();
    setTranscriberForTests(async () => {
      throw new Error("should not be called");
    });
    expect(await json(await transcribePost(audio(100, undefined, jar)))).toEqual({ text: "" });
  });

  it("maps an AI outage to a 503 with a seller-safe message", async () => {
    const jar = await newSession();
    setTranscriberForTests(async () => {
      throw new AiError("The AI assistant is unavailable right now. Please retry.", "unavailable");
    });
    const res = await transcribePost(audio(5000, undefined, jar));
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("AI_UNAVAILABLE");
  });
});

describe("POST /api/imports/[id]/filter", () => {
  it("passes the batch's real values to the extractor and returns its filter", async () => {
    const jar = await newSession();
    const { body } = await upload(jar, "planted-errors.xlsx");
    let seen: FilterInput | null = null;
    setFilterExtractorForTests(async (input) => ((seen = input), { filter: { destinationCountries: ["Germany"], rowFrom: 1, rowTo: 7 }, clarification: null }));
    const res = await filterPost(req(`/api/imports/${body.batchId}/filter`, { method: "POST", jar, body: { message: "rows 1 to 7 going to Germany", current: { statuses: ["Blocked"] } } }), ctx(body.batchId));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ filter: { destinationCountries: ["Germany"], rowFrom: 1, rowTo: 7 }, clarification: null });
    expect(seen!.current).toEqual({ statuses: ["Blocked"] });
    expect(seen!.facets.total).toBe(12);
    expect(seen!.facets.destinationCountries.length).toBeGreaterThan(0);
    for (const c of seen!.facets.destinationCountries) expect(["Germany", "France", "Netherlands"]).toContain(c);
  });

  it("is private to the session that uploaded the workbook, and validates the body", async () => {
    const owner = await newSession();
    const other = await newSession();
    const { body } = await upload(owner, "planted-errors.xlsx");
    setFilterExtractorForTests(async () => ({ filter: {}, clarification: null }));
    const call = (jar: typeof owner, b: unknown) => filterPost(req(`/api/imports/${body.batchId}/filter`, { method: "POST", jar, body: b }), ctx(body.batchId));
    expect((await call(other, { message: "germany" })).status).toBe(404);
    expect((await call(owner, { message: "" })).status).toBe(400);
    expect((await call(owner, { message: "x", current: { destinationCountries: ["Spain"] } })).status).toBe(400);
    expect((await call(owner, { message: "germany" })).status).toBe(200);
  });
});
