import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { anonymousSessions } from "../db/schema";

export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 7) || 7;
const TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
/** Don't write last_seen on every request; refresh the sliding expiry at most every 10 minutes. */
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export const SECURE_COOKIE = "__Host-shipmentos_sid";
export const DEV_COOKIE = "shipmentos_sid";

export type SessionRef = { id: string; expiresAt: Date };

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 32 bytes = 256 bits from the OS CSPRNG, base64url encoded. Only the SHA-256 digest is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(db: Db, now = new Date()): Promise<SessionRef & { token: string }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const [row] = await db
    .insert(anonymousSessions)
    .values({ tokenHash: hashToken(token), createdAt: now, lastSeenAt: now, expiresAt })
    .returning({ id: anonymousSessions.id, expiresAt: anonymousSessions.expiresAt });
  // Best-effort bounded cleanup of expired sessions (cascades to their bookings, imports, messages).
  await purgeExpiredSessions(db, now, 50).catch(() => undefined);
  return { ...row, token };
}

export async function purgeExpiredSessions(db: Db, now = new Date(), limit = 50): Promise<number> {
  const expired = await db
    .select({ id: anonymousSessions.id })
    .from(anonymousSessions)
    .where(lt(anonymousSessions.expiresAt, now))
    .limit(limit);
  if (!expired.length) return 0;
  await db.delete(anonymousSessions).where(inArray(anonymousSessions.id, expired.map((e) => e.id)));
  return expired.length;
}

/** Resolve a raw cookie token to a live session, sliding its expiry. Expired or unknown → null. */
export async function resolveSession(db: Db, token: string | undefined | null, now = new Date()): Promise<SessionRef | null> {
  if (!token || token.length < 40 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const [row] = await db
    .select({ id: anonymousSessions.id, expiresAt: anonymousSessions.expiresAt, lastSeenAt: anonymousSessions.lastSeenAt })
    .from(anonymousSessions)
    .where(and(eq(anonymousSessions.tokenHash, hashToken(token)), gt(anonymousSessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const expiresAt = new Date(now.getTime() + TTL_MS);
    await db
      .update(anonymousSessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(anonymousSessions.id, row.id));
    return { id: row.id, expiresAt };
  }
  return { id: row.id, expiresAt: row.expiresAt };
}

/** Deletes the session and (via FK cascade) every booking, message, revision, evaluation and import it owns. */
export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(anonymousSessions).where(eq(anonymousSessions.id, sessionId));
}

export async function countSessionsByHash(db: Db, token: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(anonymousSessions)
    .where(eq(anonymousSessions.tokenHash, hashToken(token)));
  return r.n;
}
