import "./env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { describeDbUrl, requireEnv } from "./env";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? requireEnv("DATABASE_URL");
  const client = new Client({ connectionString: url });
  await client.connect();
  console.log(`Migrating ${describeDbUrl(url)} …`);
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  const { rows } = await client.query(
    "select count(*)::int as n from drizzle.__drizzle_migrations",
  );
  console.log(`Migrations applied: ${rows[0].n}`);
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
