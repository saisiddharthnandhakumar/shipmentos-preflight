import { NextRequest } from "next/server";

export const BASE = "http://localhost:3000";

export type Jar = { cookie: string | null };
export const newJar = (): Jar => ({ cookie: null });

export function req(
  path: string,
  init: { method?: string; body?: unknown; jar?: Jar; origin?: string | null; headers?: Record<string, string>; rawBody?: BodyInit } = {},
): NextRequest {
  const headers: Record<string, string> = { host: "localhost:3000", ...(init.headers ?? {}) };
  const origin = init.origin === undefined ? BASE : init.origin;
  if (origin) headers.origin = origin;
  if (init.jar?.cookie) headers.cookie = init.jar.cookie;
  let body: BodyInit | undefined = init.rawBody;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? "GET", headers, body });
}

/** Store the session cookie from a Set-Cookie response header into the jar. */
export function capture(jar: Jar, res: Response) {
  const set = res.headers.get("set-cookie");
  if (!set) return;
  const [pair] = set.split(";");
  const [, value] = pair.split("=");
  jar.cookie = value ? pair : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper returns loosely typed JSON
export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
