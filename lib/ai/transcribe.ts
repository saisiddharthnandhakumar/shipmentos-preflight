import "server-only";
import { AiError, geminiClient, geminiModel, lowThinking, toAiError } from "./gemini-client";

/**
 * Speech to text only: Gemini hears the recording and returns the words. The transcript is put in
 * the message box for the seller to read and edit; nothing is booked or filtered from audio directly.
 */
export type Transcriber = (audio: { data: Buffer; mimeType: string }) => Promise<string>;

const PROMPT = `Transcribe this audio recording exactly as spoken, in the language spoken (usually English).
It is a UK seller talking about a freight shipment: pallets, cartons, SKUs, HS codes, weights in kg, prices in GBP, UK and EU cities, dates.
Write numbers and dates as digits where natural ("3 pallets", "5 Nov", "£5,400"). Keep the seller's own wording; do not add, summarise, correct or answer anything.
If there is no intelligible speech, return an empty string. Output only the transcript, with no quotation marks or commentary.`;

export const geminiTranscriber: Transcriber = async ({ data, mimeType }) => {
  const client = geminiClient();
  const model = geminiModel();
  try {
    const res = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType, data: data.toString("base64") } }] }],
      config: { temperature: 0, ...lowThinking(model), abortSignal: AbortSignal.timeout(25_000) },
    });
    return (res.text ?? "").trim();
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw toAiError(err, "transcribe that");
  }
};

let override: Transcriber | null = null;
/** Test hook: replace the transcriber so tests never call Gemini. */
export function setTranscriberForTests(t: Transcriber | null) {
  override = t;
}
export function getTranscriber(): Transcriber {
  if (override) return override;
  // Local E2E only, never on Vercel.
  if (process.env.SHIPMENTOS_FAKE_AI === "1" && !process.env.VERCEL) return async () => "3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt";
  return geminiTranscriber;
}
