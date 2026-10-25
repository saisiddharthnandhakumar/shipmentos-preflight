import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { verifyReference } from "@/lib/db/reference";

export const runtime = "nodejs";

/** Liveness + reference-data readiness. Never exposes connection details or env values. */
export async function GET() {
  const startedAt = Date.now();
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const ref = await verifyReference(db);
    return NextResponse.json(
      {
        ok: ref.ok,
        database: "reachable",
        reference: { carrierOptions: ref.carrierCount, ruleDefinitions: ref.ruleCount, parity: ref.ok ? "ok" : "mismatch" },
        ai: process.env.GEMINI_API_KEY ? "configured" : "not configured",
        latencyMs: Date.now() - startedAt,
      },
      { status: ref.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
