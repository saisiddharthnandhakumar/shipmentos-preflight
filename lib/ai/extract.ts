import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ChatPatchSchema, type ChatPatch, type DraftBooking } from "../domain/schemas";
import { fakeExtractor as fakeExtractorRef } from "./fake-extractor";

/**
 * Gemini is used ONLY to turn one seller message into typed patch operations.
 * It never computes totals, rule verdicts, carrier choices, statuses or dates.
 */
export type ExtractInput = {
  message: string;
  draft: DraftBooking;
  recentMessages: { role: "user" | "assistant" | "event"; content: string }[];
};
export type Extractor = (input: ExtractInput) => Promise<ChatPatch>;

export class ExtractionError extends Error {
  constructor(message: string, public kind: "unavailable" | "invalid_output" | "timeout") {
    super(message);
    this.name = "ExtractionError";
  }
}

/** Verified 2026-10-25: gemini-2.5-flash is closed to new API users; 3.5 Flash was fastest and most accurate on the demo turns (scripts/eval-extractor.ts). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

const SYSTEM = `You convert ONE message from a UK seller into JSON patch operations for a shipment booking draft.
The app (not you) validates values, does all arithmetic, runs compliance rules, picks carriers and asks follow-up questions.

Output: {"operations": [...], "clarification": string|null, "question": string|null}

Operation shapes:
- {"op":"set","field":F,"value":V}            set a booking field to the value the seller stated
- {"op":"increment","field":N,"by":number}     relative change ("add one more pallet" → by 1, "two fewer cartons" → by -2)
- {"op":"remove","field":F}                    seller withdraws a value
- {"op":"addItem","item":{...item fields}}     a NEW product line
- {"op":"updateItem","target":{"itemId"|"sku"},"changes":{...item fields}}
- {"op":"incrementItem","target":{...},"field":"quantityUnits"|"cartons"|"unitsPerCarton","by":number}
- {"op":"removeItem","target":{...}}

Booking fields F: sellerName, originCity, destinationCity, destinationCountry, destinationType ("Warehouse"|"Business address"),
readyToShipDate, sellerPriority ("Cheapest"|"Fastest"|"Most reliable"|"Balanced"), pallets, cartons (TOTAL cartons on the booking),
totalDeclaredValueGBP, totalGrossWeightKg, deliveryAppointmentBooked (true/false), selectedCarrierKey ("Carrier A"|"Carrier B"|"Carrier C" or "auto").
Numeric fields N: pallets, cartons, totalDeclaredValueGBP, totalGrossWeightKg.
Item fields: sku, description, hsCode, quantityUnits, unitPriceGBP, unitsPerCarton, cartons (cartons of THIS item), unitWeightKg, countryOfOrigin.

Rules:
1. Only extract facts the seller actually stated in THIS message (use the recent conversation to resolve short answers like "yes", "12", "Northfield").
2. NEVER invent or estimate values (no guessed HS codes, weights, prices, quantities, dates or seller names). Never compute totals.
3. Relative changes MUST use increment/incrementItem with the stated delta, never set.
4. readyToShipDate: copy the seller's date wording verbatim (e.g. "5 Nov", "05-11-2026", "next Friday"). Do not convert it.
5. Use existing itemId (preferred) or SKU from the current draft to target items. If the draft has one item and the seller talks about "the mugs", target that item.
   Use addItem only for a genuinely new product. Put quantities/prices/weights given per product on that item.
6. If the seller says they have no HS code / don't know the country of origin and want to continue, set hsCode "" / countryOfOrigin "" on that item.
7a. For a new destination, set destinationCity (its country is derived); set destinationCountry only when no city is named.
7. "warehouse", "fulfilment centre", "Amazon FC" → destinationType "Warehouse"; "shop", "office", "store" → "Business address".
8. "cheap"/"lowest cost" → Cheapest, "fast"/"urgent" → Fastest, "reliable"/"on time" → Most reliable, "no preference"/"balance" → Balanced.
9. Delivery appointment: "I've booked the slot/appointment" → true; "not yet"/"no appointment" → false.
10. If the message is ambiguous (e.g. "change it to 5" with no clear target), return no operations and put a short question in "clarification".
11. If the seller asks a general question (e.g. "what is an HS code?"), answer it in one or two plain sentences in "question" (no shipment numbers, no compliance guarantees).
12. Return valid JSON only.`;

/** Flat schema Gemini can follow reliably; Zod (ChatPatchSchema) is the authority afterwards. */
const ITEM_PROPS = {
  sku: { type: ["string", "null"] },
  description: { type: ["string", "null"] },
  hsCode: { type: ["string", "null"] },
  quantityUnits: { type: ["number", "null"] },
  unitPriceGBP: { type: ["number", "null"] },
  unitsPerCarton: { type: ["number", "null"] },
  cartons: { type: ["number", "null"] },
  unitWeightKg: { type: ["number", "null"] },
  countryOfOrigin: { type: ["string", "null"] },
};
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["set", "increment", "remove", "addItem", "updateItem", "incrementItem", "removeItem"] },
          field: { type: ["string", "null"] },
          value: { type: ["string", "number", "boolean", "null"] },
          by: { type: ["number", "null"] },
          target: { type: ["object", "null"], properties: { itemId: { type: ["string", "null"] }, sku: { type: ["string", "null"] } } },
          item: { type: ["object", "null"], properties: ITEM_PROPS },
          changes: { type: ["object", "null"], properties: ITEM_PROPS },
        },
        required: ["op"],
      },
    },
    clarification: { type: ["string", "null"] },
    question: { type: ["string", "null"] },
  },
  required: ["operations"],
};

function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      // Keep explicit null `value` on set (means "clear"); drop other nulls Gemini fills in.
      if (val === null && k !== "value") continue;
      out[k] = stripNulls(val);
    }
    return out;
  }
  return v;
}

/** Validate untrusted model output. Exported for tests. */
export function parseModelOutput(text: string): { ok: true; patch: ChatPatch } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Response was not valid JSON." };
  }
  const cleaned = stripNulls(raw) as { operations?: unknown[] };
  // An item op whose changes are all null collapses to {} — drop empty no-ops rather than failing.
  if (Array.isArray(cleaned.operations))
    cleaned.operations = cleaned.operations.filter((o) => {
      const op = o as { op?: string; changes?: object; item?: object };
      if (op.op === "updateItem") return op.changes && Object.keys(op.changes).length > 0;
      return true;
    });
  const parsed = ChatPatchSchema.safeParse(cleaned);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, patch: parsed.data };
}

function compactDraft(d: DraftBooking) {
  const { originCountry: _o, currency: _c, readyDateNote: _n, ...rest } = d;
  void _o; void _c; void _n;
  return { ...rest, items: d.items.map(({ sourceRow: _s, ...i }) => (void _s, i)) };
}

let client: GoogleGenAI | null = null;
const minimalUnsupported = new Set<string>();

/** MINIMAL where the model accepts it (fastest); models that reject it fall back to LOW. */
function thinkingLevelFor(model: string): ThinkingLevel {
  return minimalUnsupported.has(model) ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL;
}

export const geminiExtractor: Extractor = async (input) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ExtractionError("The AI assistant isn't configured. Use the Edit booking form to enter details.", "unavailable");
  client ??= new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const context = input.recentMessages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Seller" : m.role === "assistant" ? "Assistant" : "Event"}: ${m.content.slice(0, 600)}`)
    .join("\n");
  const prompt = `Current booking draft (JSON, null = unknown, "" = seller confirmed blank):\n${JSON.stringify(compactDraft(input.draft))}\n\nRecent conversation:\n${context || "(none)"}\n\nNew seller message:\n${input.message}`;

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const contents = attempt === 0 ? prompt : `${prompt}\n\nYour previous output was invalid (${lastError}). Return corrected JSON that matches the operation shapes exactly.`;
    let text: string | undefined;
    try {
      const res = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
          temperature: 0,
          // Extraction is a short structured task: keep model thinking minimal for latency.
          ...(model.startsWith("gemini-2.5")
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : /^gemini-3/.test(model)
              ? { thinkingConfig: { thinkingLevel: thinkingLevelFor(model) } }
              : {}),
          abortSignal: AbortSignal.timeout(20_000),
        },
      });
      text = res.text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Thinking level MINIMAL is not supported/i.test(msg) && !minimalUnsupported.has(model)) {
        minimalUnsupported.add(model);
        attempt--; // config retry, not a repair attempt
        continue;
      }
      if (/abort|timeout/i.test(msg)) throw new ExtractionError("The AI assistant took too long to respond. Please retry.", "timeout");
      console.error("Gemini call failed:", msg.slice(0, 200).replace(/key=[^&\s]+/g, "key=***"));
      throw new ExtractionError("The AI assistant is unavailable right now. Retry, or use the Edit booking form.", "unavailable");
    }
    const parsed = parseModelOutput(text ?? "");
    if (parsed.ok) return parsed.patch;
    lastError = parsed.error;
  }
  throw new ExtractionError("I couldn't understand that reliably. Could you rephrase, or use the Edit booking form?", "invalid_output");
};

let override: Extractor | null = null;
/** Test hook: replace the extractor (unit/integration/E2E tests run without calling Gemini). */
export function setExtractorForTests(e: Extractor | null) {
  override = e;
}
export function getExtractor(): Extractor {
  if (override) return override;
  // Local E2E only: deterministic extractor; never active on Vercel deployments.
  if (process.env.SHIPMENTOS_FAKE_AI === "1" && !process.env.VERCEL) return fakeExtractorRef;
  return geminiExtractor;
}
