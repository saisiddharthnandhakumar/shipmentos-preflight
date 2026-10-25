import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DatabaseUnavailableError, getDb, type Db } from "../db/client";
import { rateLimit } from "./rate-limit";
import {
  DEV_COOKIE,
  SECURE_COOKIE,
  SESSION_TTL_DAYS,
  createSession,
  resolveSession,
  type SessionRef,
} from "./session";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return proto === "https";
}

export function cookieNameFor(req: NextRequest): string {
  return isSecureRequest(req) ? SECURE_COOKIE : DEV_COOKIE;
}

export function readSessionToken(req: NextRequest): string | undefined {
  return req.cookies.get(cookieNameFor(req))?.value;
}

export function setSessionCookie(res: NextResponse, req: NextRequest, token: string) {
  res.cookies.set({
    name: cookieNameFor(req),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(res: NextResponse, req: NextRequest) {
  res.cookies.set({
    name: cookieNameFor(req),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: 0,
  });
}

/** State-changing requests must come from this site's own pages. */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) throw new ApiError(403, "ORIGIN_REQUIRED", "Missing Origin header.");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "BAD_ORIGIN", "Invalid Origin header.");
  }
  if (!host || originHost !== host) throw new ApiError(403, "BAD_ORIGIN", "Cross-origin request rejected.");
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export function enforceRateLimit(req: NextRequest, sessionId: string, bucket: string, limit: number, windowMs = 60_000) {
  if (!rateLimit(`${bucket}:${sessionId}:${clientIp(req)}`, limit, windowMs)) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }
}

export type Ctx = { db: Db; session: SessionRef };

/** Resolve the cookie session. Throws 401 SESSION_REQUIRED when missing or expired. */
export async function requireSession(req: NextRequest): Promise<Ctx> {
  const db = getDb();
  const session = await resolveSession(db, readSessionToken(req));
  if (!session) throw new ApiError(401, "SESSION_REQUIRED", "Your session has expired or was not found. Reload to start a new one.");
  return { db, session };
}

export { createSession };

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "The request was not valid.", details: err.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 400 },
    );
  }
  if (isDbConnectivityError(err)) {
    return NextResponse.json(
      { error: { code: "DB_UNAVAILABLE", message: "Unable to save right now — the database is unreachable. Nothing was changed; please retry." } },
      { status: 503 },
    );
  }
  // Log only the error class/message, never request bodies or connection strings.
  console.error("Unhandled API error:", err instanceof Error ? `${err.name}: ${redact(err.message)}` : "unknown");
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Nothing was saved; please retry." } }, { status: 500 });
}

function redact(s: string): string {
  return s.replace(/postgres(ql)?:\/\/[^\s]+/g, "postgresql://***");
}

export function isDbConnectivityError(err: unknown): boolean {
  if (err instanceof DatabaseUnavailableError) return true;
  const e = err as { code?: string; message?: string; cause?: unknown } | null;
  if (!e) return false;
  const code = e.code ?? "";
  const msg = e.message ?? "";
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "57P01", "57P03", "08006", "08001"].includes(code)) return true;
  if (/Connection terminated|timeout exceeded when trying to connect|getaddrinfo/i.test(msg)) return true;
  return e.cause ? isDbConnectivityError(e.cause) : false;
}

export async function readJson(req: NextRequest, maxBytes = 32_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new ApiError(413, "TOO_LARGE", "Request body too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "TOO_LARGE", "Request body too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be JSON.");
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(id: string, what = "booking") {
  // A malformed id is indistinguishable from someone else's: always 404.
  if (!UUID_RE.test(id)) throw new ApiError(404, "NOT_FOUND", `That ${what} was not found in this browser session.`);
}
