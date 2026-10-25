import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import { seedReference, verifyReference } from "@/lib/db/reference";

afterAll(closeDb);

describe("fixed reference data in Neon", () => {
  it("re-running the seed is idempotent: exactly 9 carriers and 10 rules with fixture parity", async () => {
    const db = getDb();
    await seedReference(db);
    await seedReference(db);
    const r = await verifyReference(db);
    expect(r).toEqual({ ok: true, carrierCount: 9, ruleCount: 10, problems: [] });
  });

  it("migrations are applied", async () => {
    const db = getDb();
    const res = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect((res.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(1);
  });
});
