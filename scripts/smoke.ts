/**
 * Live smoke test against a deployed ShipmentOS (synthetic data only, its own fresh sessions).
 * Usage: SMOKE_URL=https://<app>.vercel.app npx tsx scripts/smoke.ts
 */
import { readFileSync } from "node:fs";

const BASE = (process.env.SMOKE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("SMOKE_URL is required");

type Jar = { cookie: string | null };
let failures = 0;
const ok = (cond: unknown, label: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

async function call(jar: Jar, path: string, init: { method?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = { origin: BASE };
  if (jar.cookie) headers.cookie = jar.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    redirect: "manual",
  });
  const set = res.headers.get("set-cookie");
  if (set) jar.cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const rid = () => `smoke${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  console.log(`Smoke testing ${BASE}\n`);
  const anon: Jar = { cookie: null };
  const home = await call(anon, "/chat");
  ok(home.status === 200 && /ShipmentOS/.test(home.text), "GET /chat is public (no login, 200)");
  ok(!/vercel\.com\/login|Authentication Required/i.test(home.text), "No Vercel auth wall");
  const health = await call(anon, "/api/health");
  ok(health.status === 200 && health.json?.reference?.carrierOptions === 9 && health.json?.reference?.ruleDefinitions === 10, "Health: DB reachable, 9 carriers, 10 rules, parity ok");
  ok(health.json?.ai === "configured", "Gemini key configured server-side");

  // No secrets in HTML or client JS
  const scripts = [...home.text.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  let leaked = false;
  for (const s of scripts) {
    const js = await (await fetch(`${BASE}${s}`)).text();
    if (/postgres(ql)?:\/\/|npg_[A-Za-z0-9]{6,}|GEMINI_API_KEY|AQ\.[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}/.test(js)) leaked = true;
  }
  ok(scripts.length > 0 && !leaked, `No secrets in ${scripts.length} client bundles`);

  // Session A
  const a: Jar = { cookie: null };
  const s = await call(a, "/api/session", { method: "POST" });
  ok(s.status === 200 && a.cookie?.startsWith("__Host-shipmentos_sid="), "Session cookie is __Host- prefixed");
  ok(/HttpOnly/i.test(s.headers.get("set-cookie") ?? "") && /Secure/i.test(s.headers.get("set-cookie") ?? ""), "Cookie HttpOnly + Secure");
  ok(!JSON.stringify(s.json).includes(a.cookie!.split("=")[1]), "Token never in JSON");

  // Chat with real Gemini
  const id = (await call(a, "/api/bookings", { method: "POST", body: { clientKey: rid() } })).json?.bookingId;
  ok(Boolean(id), "Create chat booking");
  let t = await call(a, "/api/chat", { method: "POST", body: { bookingId: id, expectedRevision: 0, requestId: rid(), message: "I need 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready 5 Nov. Cheapest please." } });
  ok(t.status === 200 && t.json?.snapshot?.draft?.pallets === 3 && t.json?.snapshot?.draft?.destinationCity === "Frankfurt", "Gemini extracted opening facts");
  t = await call(a, "/api/chat", {
    method: "POST",
    body: { bookingId: id, expectedRevision: 1, requestId: rid(), message: "We're Northfield Goods. SKU MUG-01: 1080 mugs, 90 cartons of 12, £5 each, 0.5 kg each, HS 691200, made in the UK. Gross weight 620 kg, declared value £5,400, 90 cartons in total. Appointment is booked." },
  });
  ok(t.status === 200 && t.json?.snapshot?.evaluation?.status === "Ready to submit", `Booking complete → ${t.json?.snapshot?.evaluation?.status}`);
  const plusReq = rid();
  const plus = await call(a, "/api/chat", { method: "POST", body: { bookingId: id, expectedRevision: 2, requestId: plusReq, message: "Actually, add one more pallet." } });
  const costA = plus.json?.snapshot?.evaluation?.carrier?.candidates?.find((c: { option: { key: string } }) => c.option.key === "GB-DE-A")?.totalCostGBP;
  ok(plus.json?.snapshot?.draft?.pallets === 4 && costA === 720 && plus.json?.revision === 3, `+1 pallet → 4 pallets, £${costA}, rev ${plus.json?.revision}`);
  const replay = await call(a, "/api/chat", { method: "POST", body: { bookingId: id, expectedRevision: 2, requestId: plusReq, message: "Actually, add one more pallet." } });
  ok(replay.json?.replayed === true && replay.json?.snapshot?.draft?.pallets === 4, "Retried requestId replays, pallets stay 4");
  const stale = await call(a, "/api/chat", { method: "POST", body: { bookingId: id, expectedRevision: 1, requestId: rid(), message: "add one more pallet" } });
  ok(stale.status === 409, "Stale revision → 409");

  // Second chat + history
  const id2 = (await call(a, "/api/bookings", { method: "POST", body: { clientKey: rid() } })).json?.bookingId;
  await call(a, "/api/chat", { method: "POST", body: { bookingId: id2, expectedRevision: 0, requestId: rid(), message: "2 pallets of cotton t-shirts from London to a shop in Paris, fastest please." } });
  const chats = await call(a, "/api/chats");
  ok(chats.json?.items?.length === 2 && chats.json.items[0].id === id2, "Previous chats lists both, newest first");
  const msgs = await call(a, `/api/chats/${id}/messages`);
  ok(msgs.json?.messages?.length === 6 && msgs.json.messages[0].role === "user", "Transcript of first chat: 6 messages in order");

  // Uploads
  for (const [f, total] of [["clean.xlsx", 3], ["planted-errors.xlsx", 12]] as const) {
    const form = new FormData();
    form.append("file", new File([readFileSync(`tests/fixtures/${f}`)], f));
    const up = await call(a, "/api/import", { method: "POST", form });
    ok(up.status === 201 && up.json?.summary?.total === total, `Upload ${f} → ${up.json?.summary?.total} bookings (${up.json?.summary?.blocked} blocked)`);
  }
  const all = await call(a, "/api/bookings?limit=100");
  ok(all.json?.items?.filter((b: { source: string }) => b.source === "excel").length === 15 && all.json.items.filter((b: { source: string }) => b.source === "chat").length === 2, "All bookings: 2 chats + 15 Excel");

  // No eligible carrier case appears in planted file (BK-205)
  const bk205 = all.json.items.find((b: { externalBookingId: string }) => b.externalBookingId === "BK-205");
  const d205 = await call(a, `/api/bookings/${bk205.id}`);
  ok(d205.json?.evaluation?.carrier?.status === "no_eligible" && d205.json?.evaluation?.carrier?.requiredPallets === 3, "BK-205: no eligible carrier, suggests 3 pallets");

  // Session B isolation
  const b: Jar = { cookie: null };
  await call(b, "/api/session", { method: "POST" });
  ok((await call(b, "/api/chats")).json?.items?.length === 0, "Other session: empty Previous chats");
  ok((await call(b, `/api/bookings/${id}`)).status === 404, "Other session: booking 404");
  ok((await call(b, `/api/chats/${id}/messages`)).status === 404, "Other session: transcript 404");
  ok((await call(b, `/api/chats/${id}`, { method: "DELETE" })).status === 404, "Other session: delete 404");
  ok((await call({ cookie: null }, "/api/chats")).status === 401, "No cookie: 401");

  // Delete second chat
  ok((await call(a, `/api/chats/${id2}`, { method: "DELETE" })).status === 200, "Delete own chat");
  ok((await call(a, "/api/chats")).json?.items?.length === 1, "One chat remains");
  ok((await call(a, "/api/bookings?source=excel&limit=100")).json?.items?.length === 15, "Imports untouched by chat delete");

  // Clean up the smoke sessions' data
  await call(a, "/api/session", { method: "DELETE" });
  await call(b, "/api/session", { method: "DELETE" });
  console.log(`\n${failures ? `${failures} FAILED` : "ALL PASSED"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
