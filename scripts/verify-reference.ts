import "./env";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { verifyReference } from "../lib/db/reference";
import * as schema from "../lib/db/schema";
import { describeDbUrl, requireEnv } from "./env";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? requireEnv("DATABASE_URL");
  const client = new Client({ connectionString: url });
  await client.connect();
  const db = drizzle(client, { schema });
  const report = await verifyReference(db);
  const { rows } = await client.query(
    "select key, carrier, service, destination_country, price_per_pallet_gbp, transit_days, on_time_percent, max_kg_per_pallet from carrier_options order by destination_country, key",
  );
  console.log(`Target: ${describeDbUrl(url)}`);
  console.table(rows);
  console.log(`carrier_options=${report.carrierCount} rule_definitions=${report.ruleCount} parity=${report.ok ? "OK" : "FAILED"}`);
  for (const p of report.problems) console.log(` - ${p}`);
  await client.end();
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error("Verify failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
