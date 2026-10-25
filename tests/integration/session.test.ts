import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { DELETE as sessionDelete, GET as sessionGet, POST as sessionPost } from "@/app/api/session/route";
import { closeDb, getDb } from "@/lib/db/client";
import { anonymousSessions } from "@/lib/db/schema";
import { countSessionsByHash, createSession, hashToken, resolveSession } from "@/lib/server/session";
import { capture, json, newJar, req } from "../helpers/http";

afterAll(closeDb);

describe("anonymous sessions", () => {
  it("POST sets an HttpOnly SameSite=Lax cookie, stores only the SHA-256 hash, never returns the token", async () => {
    const res = await sessionPost(req("/api/session", { method: "POST" }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^shipmentos_sid=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const token = /shipmentos_sid=([^;]+)/.exec(setCookie)![1];
    const body = JSON.stringify(await json(res));
    expect(body).not.toContain(token);
    expect(body).not.toContain(hashToken(token));
    expect(await countSessionsByHash(getDb(), token)).toBe(1);
    const raw = await getDb().execute(sql`select count(*)::int as n from anonymous_sessions where token_hash = ${token}`);
    expect((raw.rows[0] as { n: number }).n).toBe(0); // raw token is not stored
  });

  it("uses a __Host- Secure cookie over HTTPS", async () => {
    const r = req("/api/session", { method: "POST", headers: { "x-forwarded-proto": "https" } });
    const res = await sessionPost(r);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^__Host-shipmentos_sid=/);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/Path=\//);
  });

  it("resumes the same session and rejects writes without a same-site Origin", async () => {
    const jar = newJar();
    capture(jar, await sessionPost(req("/api/session", { method: "POST" })));
    const again = await sessionPost(req("/api/session", { method: "POST", jar }));
    expect((await json(again)).created).toBe(false);
    expect((await sessionPost(req("/api/session", { method: "POST", origin: null }))).status).toBe(403);
    expect((await sessionPost(req("/api/session", { method: "POST", origin: "https://evil.example" }))).status).toBe(403);
  });

  it("expired tokens resolve to nothing and GET returns 401", async () => {
    const db = getDb();
    const s = await createSession(db);
    await db.update(anonymousSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(anonymousSessions.id, s.id));
    expect(await resolveSession(db, s.token)).toBeNull();
    const res = await sessionGet(req("/api/session", { jar: { cookie: `shipmentos_sid=${s.token}` } }));
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("SESSION_REQUIRED");
  });

  it("garbage tokens are rejected without a DB match", async () => {
    expect(await resolveSession(getDb(), "short")).toBeNull();
    expect(await resolveSession(getDb(), "x".repeat(43))).toBeNull();
  });

  it("DELETE resets the session and clears the cookie", async () => {
    const jar = newJar();
    capture(jar, await sessionPost(req("/api/session", { method: "POST" })));
    const del = await sessionDelete(req("/api/session", { method: "DELETE", jar }));
    expect(del.status).toBe(200);
    expect(del.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await sessionGet(req("/api/session", { jar }))).status).toBe(401);
  });
});
