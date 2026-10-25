import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  ApiError,
  assertSameOrigin,
  clearSessionCookie,
  createSession,
  errorResponse,
  readSessionToken,
  requireSession,
  setSessionCookie,
} from "@/lib/server/http";
import { SESSION_TTL_DAYS, deleteSession, resolveSession } from "@/lib/server/session";
import { rateLimit } from "@/lib/server/rate-limit";
import { clientIp } from "@/lib/server/http";

export const runtime = "nodejs";

/** Create (or resume) the anonymous session. Never returns the raw token or its hash. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const db = getDb();
    const existing = await resolveSession(db, readSessionToken(req));
    if (existing) {
      return NextResponse.json({ session: { expiresAt: existing.expiresAt.toISOString(), ttlDays: SESSION_TTL_DAYS }, created: false });
    }
    if (!rateLimit(`session-create:${clientIp(req)}`, 30, 60_000)) throw new ApiError(429, "RATE_LIMITED", "Too many new sessions from this network. Please wait a minute.");
    const s = await createSession(db);
    const res = NextResponse.json({ session: { expiresAt: s.expiresAt.toISOString(), ttlDays: SESSION_TTL_DAYS }, created: true });
    setSessionCookie(res, req, s.token);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { session } = await requireSession(req);
    return NextResponse.json({ session: { expiresAt: session.expiresAt.toISOString(), ttlDays: SESSION_TTL_DAYS } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** "Reset my data": deletes the session and everything it owns, then clears the cookie. */
export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { db, session } = await requireSession(req);
    await deleteSession(db, session.id);
    const res = NextResponse.json({ deleted: true });
    clearSessionCookie(res, req);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
