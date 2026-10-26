import "server-only";
import { BookingFilterSchema, normaliseFilter, type BookingFilter } from "../domain/booking-filter";
import { AiError, geminiClient, geminiModel, lowThinking, toAiError } from "./gemini-client";

/**
 * Gemini turns one sentence about an uploaded workbook into a BookingFilter. It never lists,
 * counts or judges bookings: the app applies the filter to the stored rows with fixed rules.
 */
export type FilterFacets = { total: number; originCities: string[]; destinationCities: string[]; destinationCountries: string[]; sellers: string[] };
export type FilterInput = { message: string; current: BookingFilter; facets: FilterFacets };
export type FilterResult = { filter: BookingFilter; clarification: string | null };
export type FilterExtractor = (input: FilterInput) => Promise<FilterResult>;

const SYSTEM = `You turn ONE message from a seller into a filter over the table of bookings they just uploaded from Excel.
You do not list, count or judge bookings; the app applies your filter. Output JSON: {"filter": {...}, "clarification": string|null}.

Filter fields (omit a field you don't need):
- destinationCountries: any of "Germany","France","Netherlands" ("Holland" → Netherlands, "DE"/"FR"/"NL" accepted)
- originCities: UK origin cities as written in the data
- destinationCities: destination cities as written in the data
- statuses: any of "Blocked","Needs attention","Ready to submit","Draft" ("ready" → Ready to submit, "problems"/"failing" → Blocked and Needs attention)
- sellers: seller names as written in the data
- inputIssuesOnly: true for "with input issues"/"bad data"/"couldn't read"
- rowFrom, rowTo: 1-based row numbers in the table ("rows 1 to 7" → 1 and 7, "first 5" → rowFrom 1 rowTo 5, "row 3" → both 3)

Rules:
1. The input includes the CURRENT filter. Return the COMPLETE new filter. Refine it ("only the blocked ones", "also France") unless the seller starts over ("show everything", "clear", "now show Germany" after a different country means replace that field).
2. Every shipment starts in the UK, so "Great Britain", "UK", "England" as an origin is NOT a filter: omit it. "From Great Britain to Germany" is just destinationCountries ["Germany"].
3. Use only values that exist in the AVAILABLE VALUES lists, spelled exactly as listed. If the seller names a city, seller or country that isn't listed, leave it out and say so in "clarification" (one short sentence).
4. If the message isn't about narrowing or clearing the table, return the current filter unchanged and put a short helpful sentence in "clarification".
5. Return valid JSON only.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    filter: {
      type: "object",
      properties: {
        destinationCountries: { type: "array", items: { type: "string", enum: ["Germany", "France", "Netherlands"] } },
        originCities: { type: "array", items: { type: "string" } },
        destinationCities: { type: "array", items: { type: "string" } },
        statuses: { type: "array", items: { type: "string", enum: ["Draft", "Blocked", "Needs attention", "Ready to submit"] } },
        sellers: { type: "array", items: { type: "string" } },
        inputIssuesOnly: { type: "boolean" },
        rowFrom: { type: "integer" },
        rowTo: { type: "integer" },
      },
    },
    clarification: { type: ["string", "null"] },
  },
  required: ["filter"],
};

/** Validate untrusted model output. Exported for tests. */
export function parseFilterOutput(text: string): { ok: true; result: FilterResult } | { ok: false; error: string } {
  let raw: { filter?: unknown; clarification?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Response was not valid JSON." };
  }
  const parsed = BookingFilterSchema.safeParse(raw?.filter ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const clarification = typeof raw.clarification === "string" && raw.clarification.trim() ? raw.clarification.trim().slice(0, 240) : null;
  return { ok: true, result: { filter: normaliseFilter(parsed.data), clarification } };
}

export const geminiFilterExtractor: FilterExtractor = async ({ message, current, facets }) => {
  const client = geminiClient();
  const model = geminiModel();
  const prompt = `AVAILABLE VALUES in this upload (${facets.total} bookings):\n${JSON.stringify({ originCities: facets.originCities, destinationCountries: facets.destinationCountries, destinationCities: facets.destinationCities, sellers: facets.sellers })}\n\nCURRENT filter:\n${JSON.stringify(current)}\n\nSeller message:\n${message}`;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string | undefined;
    try {
      const res = await client.models.generateContent({
        model,
        contents: attempt === 0 ? prompt : `${prompt}\n\nYour previous output was invalid (${lastError}). Return corrected JSON.`,
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA, temperature: 0, ...lowThinking(model), abortSignal: AbortSignal.timeout(20_000) },
      });
      text = res.text;
    } catch (err) {
      throw toAiError(err, "read that");
    }
    const parsed = parseFilterOutput(text ?? "");
    if (parsed.ok) return parsed.result;
    lastError = parsed.error;
  }
  throw new AiError("I couldn't turn that into a filter. Try rephrasing, or use the status buttons and search box.", "invalid_output");
};

let override: FilterExtractor | null = null;
/** Test hook: replace the extractor so tests never call Gemini. */
export function setFilterExtractorForTests(e: FilterExtractor | null) {
  override = e;
}
export function getFilterExtractor(): FilterExtractor {
  if (override) return override;
  // Local E2E only, never on Vercel.
  if (process.env.SHIPMENTOS_FAKE_AI === "1" && !process.env.VERCEL) return fakeFilterExtractor;
  return geminiFilterExtractor;
}

/** Deterministic stand-in for local E2E: understands "<country> only", "rows a to b", "clear". */
const fakeFilterExtractor: FilterExtractor = async ({ message, current, facets }) => {
  const m = message.toLowerCase();
  if (/\b(clear|everything|all bookings|reset)\b/.test(m)) return { filter: {}, clarification: null };
  const f: BookingFilter = { ...current };
  const countries = facets.destinationCountries.filter((c) => m.includes(c.toLowerCase()));
  if (countries.length) f.destinationCountries = countries as BookingFilter["destinationCountries"];
  const rows = /rows?\s+(\d+)\s*(?:to|-|–)\s*(\d+)/.exec(m);
  if (rows) {
    f.rowFrom = Number(rows[1]);
    f.rowTo = Number(rows[2]);
  }
  for (const s of ["Blocked", "Needs attention", "Ready to submit"] as const) if (m.includes(s.toLowerCase())) f.statuses = [s];
  return { filter: normaliseFilter(f), clarification: null };
};
