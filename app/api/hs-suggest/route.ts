import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AiError } from "@/lib/ai/gemini-client";
import { getHsSuggester } from "@/lib/ai/hs-suggest";
import { checkHs, suggestHs } from "@/lib/domain/hs";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ description: z.string().trim().min(2).max(300), hsCode: z.string().trim().max(32).optional() });

/** HS code check for one product: built-in table first, AI only when the product isn't in the table. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { session } = await requireSession(req);
    enforceRateLimit(req, session.id, "hs-suggest", 30);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "BAD_REQUEST", "Send a product description of at least 2 characters.");
    const { description, hsCode } = parsed.data;

    const local = suggestHs(description);
    if (local.length) return NextResponse.json({ source: "table", suggestions: local, verdict: checkHs(description, hsCode) });
    try {
      const suggestions = await getHsSuggester()(description);
      return NextResponse.json({ source: "ai", suggestions, verdict: { kind: "unknown" } });
    } catch (err) {
      if (err instanceof AiError) throw new ApiError(err.kind === "invalid_output" ? 422 : 503, "AI_UNAVAILABLE", err.message);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
