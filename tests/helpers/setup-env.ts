import { config } from "dotenv";
// Integration tests run against the isolated Neon dev branch configured in .env.local.
config({ path: ".env.local", quiet: true });
if (process.env.DATABASE_URL && /-pooler\./.test(process.env.DATABASE_URL) && process.env.VERCEL_ENV === "production") {
  throw new Error("Refusing to run tests against production");
}
