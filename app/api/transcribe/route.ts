import { NextResponse, type NextRequest } from "next/server";
import { AiError } from "@/lib/ai/gemini-client";
import { getTranscriber } from "@/lib/ai/transcribe";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel rejects request bodies over 4.5 MB; a minute of browser audio is well under 1 MB.
const MAX_BYTES = 4_000_000;
const MIN_BYTES = 800;
const MIME: Record<string, string> = {
  "audio/webm": "audio/webm",
  "audio/ogg": "audio/ogg",
  "audio/mp4": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/aac": "audio/aac",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/flac": "audio/flac",
};

/** Speech to text: the raw recording is the request body; the reply is the words, nothing else. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { session } = await requireSession(req);
    enforceRateLimit(req, session.id, "transcribe", 12);
    const mimeType = MIME[(req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()];
    if (!mimeType) throw new ApiError(415, "UNSUPPORTED_AUDIO", "That audio format isn't supported. Please type your message instead.");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) throw new ApiError(413, "TOO_LARGE", "That recording is too long. Keep it under a minute or two.");
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > MAX_BYTES) throw new ApiError(413, "TOO_LARGE", "That recording is too long. Keep it under a minute or two.");
    if (data.length < MIN_BYTES) return NextResponse.json({ text: "" });
    try {
      return NextResponse.json({ text: (await getTranscriber()({ data, mimeType })).slice(0, 2000) });
    } catch (err) {
      if (err instanceof AiError) throw new ApiError(err.kind === "invalid_output" ? 422 : 503, "AI_UNAVAILABLE", err.message);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
