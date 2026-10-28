"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Notice, PageHeader, Skeleton } from "../ui";

type Fx = { base: "GBP"; date: string; rates: Record<string, number>; live: boolean };

const input = "h-10 w-full rounded-lg border border-control bg-sheet px-3 text-sm";
const COMMON = ["EUR", "USD", "INR", "CNY", "TRY", "VND", "JPY", "AUD", "CAD", "CHF"];

export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  const f = rates[from];
  const t = rates[to];
  if (!f || !t || !Number.isFinite(amount)) return null;
  return (amount / f) * t;
}

function fmt(n: number, code: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${code}`;
  }
}

/** Pounds to any currency and back, from European Central Bank reference rates. */
export function CurrencyConverter() {
  const [fx, setFx] = useState<Fx | null>(null);
  const [failed, setFailed] = useState(false);
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("GBP");
  const [to, setTo] = useState("EUR");

  useEffect(() => {
    let alive = true;
    fetch("/api/fx")
      .then((r) => (r.ok ? (r.json() as Promise<Fx>) : Promise.reject(new Error("fx"))))
      .then((j) => alive && setFx(j))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const codes = useMemo(() => (fx ? Object.keys(fx.rates).sort((a, b) => (a === "GBP" ? -1 : b === "GBP" ? 1 : a.localeCompare(b))) : []), [fx]);
  const n = Number(amount.replace(/,/g, ""));
  const result = fx && amount.trim() && Number.isFinite(n) ? convertAmount(n, from, to, fx.rates) : null;
  const unit = fx ? convertAmount(1, from, to, fx.rates) : null;
  const swap = () => {
    setFrom(to);
    setTo(from);
  };
  const select = (v: string, set: (s: string) => void, label: string) => (
    <select aria-label={label} className={input} value={v} onChange={(e) => set(e.target.value)}>
      {codes.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );

  return (
    <div className="h-full overflow-y-auto" data-testid="currency-converter">
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-2 pb-10 lg:px-6">
        <PageHeader title="Currency converter" description="Convert pounds to another currency, or back. Rates are daily reference rates, so a bank or carrier may quote slightly differently." />
        {failed ? (
          <Notice tone="error">Couldn&apos;t load exchange rates. Check your connection and refresh.</Notice>
        ) : !fx ? (
          <Skeleton className="h-56" />
        ) : (
          <Card>
            {!fx.live && <div className="mb-4"><Notice tone="warn">Live rates are unavailable right now, so these are approximate stored rates from {fx.date}.</Notice></div>}
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1.2fr_1fr_auto_1fr]">
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-muted">Amount</span>
                <input className={input} inputMode="decimal" name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-muted">From</span>
                {select(from, setFrom, "From currency")}
              </label>
              <Button type="button" onClick={swap} aria-label="Swap currencies" className="sm:mb-0">
                ⇄
              </Button>
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-muted">To</span>
                {select(to, setTo, "To currency")}
              </label>
            </div>

            <div className="mt-6 rounded-2xl bg-raised px-5 py-4" aria-live="polite">
              <p className="num text-caption text-muted">
                {Number.isFinite(n) && amount.trim() ? fmt(n, from) : "—"} =
              </p>
              <p className="num text-display text-text" data-testid="fx-result">{result != null ? fmt(result, to) : "—"}</p>
              {unit != null && (
                <p className="num mt-1 text-caption text-muted">
                  1 {from} = {unit.toLocaleString("en-GB", { maximumFractionDigits: 4 })} {to} · rates from {fx.date}
                </p>
              )}
            </div>

            <h3 className="mt-6 mb-2 text-heading text-text">Quick view · {amount.trim() && Number.isFinite(n) ? fmt(n, from) : from}</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {COMMON.filter((c) => c !== from && fx.rates[c]).map((c) => {
                const v = Number.isFinite(n) ? convertAmount(n, from, c, fx.rates) : null;
                return (
                  <li key={c}>
                    <button type="button" onClick={() => setTo(c)} className="block w-full rounded-xl bg-raised px-3 py-2 text-left hover:bg-active">
                      <span className="text-caption text-muted">{c}</span>
                      <span className="num block text-small text-text">{v != null ? fmt(v, c) : "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
