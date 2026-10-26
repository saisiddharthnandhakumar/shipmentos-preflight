import { NextResponse, type NextRequest } from "next/server";
import { ChatTurnBody } from "@/lib/server/api-schemas";
import { assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireSession } from "@/lib/server/http";
import { runTurn } from "@/lib/server/turns";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One chat turn: Gemini → typed patch → Zod → merge → rules → carrier → reply, persisted
 * atomically under expectedRevision and idempotent on (bookingId, requestId).
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "chat", 20);
    const body = ChatTurnBody.parse(await readJson(req));
    const r = await runTurn({ db, sessionId: session.id, kind: "chat", bookingId: body.bookingId, expectedRevision: body.expectedRevision, requestId: body.requestId, message: body.message, operations: body.operations });
    return NextResponse.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
