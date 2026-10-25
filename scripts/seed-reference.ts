import "./env";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { seedReference, verifyReference } from "../lib/db/reference";
import * as schema from "../lib/db/schema";
import { describeDbUrl, requireEnv } from "./env";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? requireEnv("DATABASE_URL");
  const client = new Client({ connectionString: url });
  await client.connect();
  const db = drizzle(client, { schema });
  console.log(`Seeding fixed reference data into ${describeDbUrl(url)} …`);
  await seedReference(db);
  const report = await verifyReference(db);
  console.log(`carrier_options=${report.carrierCount} rule_definitions=${report.ruleCount} parity=${report.ok ? "OK" : "FAILED"}`);
  for (const p of report.problems) console.log(` - ${p}`);
  await client.end();
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
