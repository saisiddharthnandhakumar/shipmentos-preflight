import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  CARRIER_OPTIONS,
  RATE_CARD_VERSION,
  RULE_DEFINITIONS,
  RULEBOOK_VERSION,
  type CarrierOption,
} from "../domain/reference";
import { carrierOptions, ruleDefinitions } from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = NodePgDatabase<any>;

/** Idempotent upsert of the nine fixed carrier options and ten rule definitions. */
export async function seedReference(db: AnyDb) {
  await db.transaction(async (tx) => {
    for (const o of CARRIER_OPTIONS) {
      const row = {
        key: o.key,
        carrier: o.carrier,
        service: o.service,
        originCountry: o.originCountry,
        destinationCountry: o.destinationCountry,
        pricePerPalletGbp: o.pricePerPalletGBP.toFixed(2),
        currency: o.currency,
        transitDays: o.transitDays,
        onTimePercent: o.onTimeRatePercent.toFixed(2),
        maxKgPerPallet: o.maxWeightPerPalletKg.toFixed(2),
        rateCardVersion: RATE_CARD_VERSION,
      };
      await tx.insert(carrierOptions).values(row).onConflictDoUpdate({ target: carrierOptions.key, set: row });
    }
    // Remove anything that is not part of the fixed card (keeps the table at exactly nine rows).
    await tx.execute(
      sql`delete from carrier_options where key not in (${sql.join(CARRIER_OPTIONS.map((o) => sql`${o.key}`), sql`, `)})`,
    );
    for (const r of RULE_DEFINITIONS) {
      const row = { ruleId: r.ruleId, description: r.description, severity: r.severity, rulebookVersion: RULEBOOK_VERSION };
      await tx.insert(ruleDefinitions).values(row).onConflictDoUpdate({ target: ruleDefinitions.ruleId, set: row });
    }
    await tx.execute(
      sql`delete from rule_definitions where rule_id not in (${sql.join(RULE_DEFINITIONS.map((r) => sql`${r.ruleId}`), sql`, `)})`,
    );
  });
}

export function carrierRowToOption(row: typeof carrierOptions.$inferSelect): CarrierOption {
  return {
    key: row.key,
    carrier: row.carrier,
    service: row.service,
    originCountry: row.originCountry as CarrierOption["originCountry"],
    destinationCountry: row.destinationCountry as CarrierOption["destinationCountry"],
    pricePerPalletGBP: Number(row.pricePerPalletGbp),
    currency: row.currency as CarrierOption["currency"],
    transitDays: row.transitDays,
    onTimeRatePercent: Number(row.onTimePercent),
    maxWeightPerPalletKg: Number(row.maxKgPerPallet),
  };
}

export type ParityReport = { ok: boolean; carrierCount: number; ruleCount: number; problems: string[] };

/** Compare seeded Neon rows with the checked-in source fixture. */
export async function verifyReference(db: AnyDb): Promise<ParityReport> {
  const problems: string[] = [];
  const carriers = await db.select().from(carrierOptions);
  const rules = await db.select().from(ruleDefinitions);
  if (carriers.length !== CARRIER_OPTIONS.length) problems.push(`expected ${CARRIER_OPTIONS.length} carrier options, found ${carriers.length}`);
  if (rules.length !== RULE_DEFINITIONS.length) problems.push(`expected ${RULE_DEFINITIONS.length} rule definitions, found ${rules.length}`);
  for (const expected of CARRIER_OPTIONS) {
    const row = carriers.find((c) => c.key === expected.key);
    if (!row) {
      problems.push(`missing carrier ${expected.key}`);
      continue;
    }
    const actual = carrierRowToOption(row);
    const fields = Object.keys(expected) as (keyof CarrierOption)[];
    const diff = fields.filter((f) => actual[f] !== expected[f]);
    if (diff.length) problems.push(`carrier ${expected.key} differs from fixture in ${diff.join(", ")}`);
    if (row.rateCardVersion !== RATE_CARD_VERSION) problems.push(`carrier ${expected.key} has version ${row.rateCardVersion}`);
  }
  for (const expected of RULE_DEFINITIONS) {
    const row = rules.find((r) => r.ruleId === expected.ruleId);
    if (!row) problems.push(`missing rule ${expected.ruleId}`);
    else if (row.description !== expected.description || row.severity !== expected.severity)
      problems.push(`rule ${expected.ruleId} differs from fixture`);
  }
  return { ok: problems.length === 0, carrierCount: carriers.length, ruleCount: rules.length, problems };
}
