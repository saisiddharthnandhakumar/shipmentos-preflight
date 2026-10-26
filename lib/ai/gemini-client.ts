import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { DEFAULT_GEMINI_MODEL } from "./extract";

/** Thrown for any Gemini failure the seller should see; `kind` picks the HTTP status. */
export class AiError extends Error {
  constructor(message: string, public kind: "unavailable" | "invalid_output" | "timeout") {
    super(message);
    this.name = "AiError";
  }
}

let client: GoogleGenAI | null = null;

export function geminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiError("The AI assistant isn't configured.", "unavailable");
  return (client ??= new GoogleGenAI({ apiKey }));
}

export const geminiModel = () => process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

/** Short structured or transcription tasks: keep model thinking as small as the model allows. */
export function lowThinking(model: string) {
  if (model.startsWith("gemini-2.5")) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-3/.test(model)) return { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };
  return {};
}

/** Map an SDK error to a seller-safe AiError (never leaks the API key). */
export function toAiError(err: unknown, what: string): AiError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort|timeout/i.test(msg)) return new AiError(`The AI assistant took too long to ${what}. Please retry.`, "timeout");
  console.error("Gemini call failed:", msg.slice(0, 200).replace(/key=[^&\s]+/g, "key=***"));
  return new AiError("The AI assistant is unavailable right now. Please retry.", "unavailable");
}
