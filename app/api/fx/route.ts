import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Reference rates from the European Central Bank via Frankfurter (no key). Cached for an hour.
const SOURCE = "https://api.frankfurter.dev/v1/latest?base=GBP";

// Used only if the live feed is unreachable, and labelled as such in the response.
const FALLBACK = { date: "2026-10-27", rates: { EUR: 1.1953, USD: 1.31, INR: 126.78, CNY: 8.8865, JPY: 210.34, AUD: 1.8953, CAD: 1.869, CHF: 1.1044, TRY: 56, VND: 33000 } as Record<string, number> };

export async function GET() {
  try {
    const r = await fetch(SOURCE, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`fx ${r.status}`);
    const j = (await r.json()) as { date: string; rates: Record<string, number> };
    if (!j?.rates || typeof j.date !== "string") throw new Error("fx shape");
    return NextResponse.json({ base: "GBP", date: j.date, rates: { GBP: 1, ...j.rates }, live: true });
  } catch {
    return NextResponse.json({ base: "GBP", date: FALLBACK.date, rates: { GBP: 1, ...FALLBACK.rates }, live: false });
  }
}
