import { config } from "dotenv";
// Scripts read .env.local (dev branch) unless the caller already exported variables.
config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Print a connection target without credentials. */
export function describeDbUrl(url: string): string {
  const u = new URL(url);
  return `${u.hostname}/${u.pathname.slice(1)}`;
}
