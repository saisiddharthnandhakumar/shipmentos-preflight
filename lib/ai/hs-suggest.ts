import "server-only";
import { Type } from "@google/genai";
import { AiError, geminiClient, geminiModel, lowThinking, toAiError } from "./gemini-client";
import type { HsSuggestion } from "../domain/hs";

/** For products the built-in table does not recognise: ask Gemini for the most likely HS headings. Advisory only. */
export type HsSuggester = (description: string) => Promise<HsSuggestion[]>;

const PROMPT = `You help UK exporters pick Harmonized System (HS) codes for goods shipped to Germany, France and the Netherlands.
Given a product description, return up to 3 likely 6-digit HS codes, most likely first, each with a short plain-English label of what the code covers.
Only return codes you are fairly confident exist. If the description is too vague or is not a product, return an empty list. Do not invent codes.`;

export const geminiHsSuggester: HsSuggester = async (description) => {
  const client = geminiClient();
  const model = geminiModel();
  try {
    const res = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: `${PROMPT}\n\nProduct description: ${description.slice(0, 300)}` }] }],
      config: {
        temperature: 0,
        ...lowThinking(model),
        abortSignal: AbortSignal.timeout(20_000),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { code: { type: Type.STRING }, label: { type: Type.STRING } }, required: ["code", "label"] } },
          },
          required: ["suggestions"],
        },
      },
    });
    const parsed = JSON.parse(res.text ?? "{}") as { suggestions?: { code?: unknown; label?: unknown }[] };
    return (parsed.suggestions ?? [])
      .filter((s): s is { code: string; label: string } => typeof s.code === "string" && typeof s.label === "string" && /^\d{6}$/.test(s.code.replace(/[\s.]/g, "")))
      .slice(0, 3)
      .map((s) => ({ code: s.code.replace(/[\s.]/g, ""), label: s.label.slice(0, 120) }));
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof SyntaxError) throw new AiError("The AI assistant gave an unusable answer. Please retry.", "invalid_output");
    throw toAiError(err, "suggest a code");
  }
};

let override: HsSuggester | null = null;
export function setHsSuggesterForTests(s: HsSuggester | null) {
  override = s;
}
export function getHsSuggester(): HsSuggester {
  if (override) return override;
  if (process.env.SHIPMENTOS_FAKE_AI === "1" && !process.env.VERCEL) return async () => [{ code: "392690", label: "Other articles of plastics" }];
  return geminiHsSuggester;
}
