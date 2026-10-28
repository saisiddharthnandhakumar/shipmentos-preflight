"use client";

import { useMemo, useState } from "react";
import { calculate, type CalcLine } from "@/lib/domain/calculator";
import { formatGBP, formatKg, formatNumber } from "@/lib/domain/decimal";
import { DESTINATION_COUNTRIES, SELLER_PRIORITIES, type DestinationCountry, type SellerPriority } from "@/lib/domain/reference";
import { Button, Card, PageHeader, cx } from "../ui";

type LineForm = { quantity: string; unitPrice: string; unitsPerCarton: string; cartons: string; unitWeightKg: string };
const blank = (): LineForm => ({ quantity: "", unitPrice: "", unitsPerCarton: "", cartons: "", unitWeightKg: "" });
const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const input = "h-9 w-full rounded-lg border border-control bg-sheet px-2.5 text-small";
const LINE_FIELDS: { key: keyof LineForm; label: string }[] = [
  { key: "quantity", label: "Quantity" },
  { key: "unitPrice", label: "Unit price (£)" },
  { key: "unitsPerCarton", label: "Units / carton" },
  { key: "cartons", label: "Cartons" },
  { key: "unitWeightKg", label: "Unit weight (kg)" },
];

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-raised px-4 py-3">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="num mt-0.5 text-card text-text">{value}</dd>
      {hint && <dd className="mt-0.5 text-caption text-muted">{hint}</dd>}
    </div>
  );
}

/** Sandbox for the carrier and pallet maths the rules engine runs. Nothing here is saved to a booking. */
export function ShippingCalculator() {
  const [destination, setDestination] = useState<DestinationCountry | "">("Germany");
  const [pallets, setPallets] = useState("3");
  const [gross, setGross] = useState("");
  const [priority, setPriority] = useState<SellerPriority | "">("Cheapest");
  const [lines, setLines] = useState<LineForm[]>([blank()]);

  const calcLines: CalcLine[] = useMemo(
    () => lines.map((l) => ({ quantity: num(l.quantity), unitPrice: num(l.unitPrice), unitsPerCarton: num(l.unitsPerCarton), cartons: num(l.cartons), unitWeightKg: num(l.unitWeightKg) })),
    [lines],
  );
  const usedLines = calcLines.filter((l) => Object.values(l).some((v) => v != null));
  const palletsN = num(pallets);
  const r = useMemo(
    () => calculate({ destination: destination || null, pallets: palletsN != null && Number.isInteger(palletsN) && palletsN > 0 ? palletsN : null, grossWeightKg: num(gross), priority: priority || null, lines: usedLines }),
    [destination, palletsN, gross, priority, usedLines],
  );
  const c = r.carrier;
  const setLine = (i: number, key: keyof LineForm, v: string) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [key]: v } : l)));
  const route = [...c.candidates].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.option.key.localeCompare(b.option.key));

  return (
    <div className="h-full overflow-y-auto" data-testid="shipping-calculator">
      <div className="mx-auto max-w-5xl space-y-4 px-4 pt-2 pb-10 lg:px-6">
        <PageHeader
          title="Shipping calculator"
          description="Try pallets, weights and prices against the same carrier rate card and checks the booking rules use. Nothing here is saved or booked."
        />

        <Card title="Shipment">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-caption font-medium text-muted">Deliver to</span>
              <select className={input} value={destination} onChange={(e) => setDestination(e.target.value as DestinationCountry | "")} name="destination">
                <option value="">—</option>
                {DESTINATION_COUNTRIES.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-caption font-medium text-muted">Pallets</span>
              <input className={input} inputMode="numeric" name="pallets" value={pallets} onChange={(e) => setPallets(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption font-medium text-muted">Gross weight (kg)</span>
              <input className={input} inputMode="decimal" name="gross" placeholder={r.minGrossWeightKg != null ? `≥ ${formatNumber(r.minGrossWeightKg, 4)} from items` : ""} value={gross} onChange={(e) => setGross(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption font-medium text-muted">Priority</span>
              <select className={input} value={priority} onChange={(e) => setPriority(e.target.value as SellerPriority | "")} name="priority">
                <option value="">—</option>
                {SELLER_PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <Card title="Items" action={<span className="text-caption text-muted">Optional: fills in value, cartons and weight</span>}>
          <div className="space-y-3">
            {lines.map((l, i) => {
              const res = r.lines[usedLines.indexOf(calcLines[i])];
              return (
                <fieldset key={i} className="rounded-xl border border-border p-3">
                  <legend className="px-1 text-caption text-muted">Line {i + 1}</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {LINE_FIELDS.map(({ key, label }) => (
                      <label key={key} className="block">
                        <span className="mb-1 block text-caption text-muted">{label}</span>
                        <input className={input} inputMode="decimal" name={`line.${i}.${key}`} value={l[key]} onChange={(e) => setLine(i, key, e.target.value)} />
                      </label>
                    ))}
                  </div>
                  {res && (
                    <p className="num mt-2 text-caption text-muted" data-testid="line-result">
                      {res.value != null && <>Line value {formatGBP(res.value)}</>}
                      {res.weightKg != null && <> · weight {formatKg(res.weightKg)}</>}
                      {res.cartonsMatch === false && (
                        <span className="text-red-ink">
                          {" "}
                          · {formatNumber(res.cartonUnits!)} units in cartons ≠ quantity{res.cartonsNeeded != null ? ` (needs ${formatNumber(res.cartonsNeeded)} cartons)` : ""}
                        </span>
                      )}
                      {res.cartonsMatch === true && <span className="text-pass-ink"> · cartons add up</span>}
                    </p>
                  )}
                  {lines.length > 1 && (
                    <div className="mt-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                        Remove line
                      </Button>
                    </div>
                  )}
                </fieldset>
              );
            })}
            <Button type="button" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
              + Add item line
            </Button>
          </div>
        </Card>

        <Card title="What the rules would see">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="calc-figures">
            <Figure label="Weight per pallet" value={c.kgPerPallet != null ? formatKg(c.kgPerPallet) : "—"} hint={r.weightIsEstimate ? "Using item weights as the gross weight" : r.weightUsedKg != null ? "Gross weight ÷ pallets" : undefined} />
            <Figure label="Items value (R-02)" value={r.itemsValue != null ? formatGBP(r.itemsValue) : "—"} hint={r.declaredRange ? `Declared value must be ${formatGBP(r.declaredRange[0])} – ${formatGBP(r.declaredRange[1])}` : undefined} />
            <Figure label="Total cartons (R-04)" value={r.totalCartons != null ? formatNumber(r.totalCartons) : "—"} hint="Sum of cartons across items" />
            <Figure label="Min gross weight (R-07)" value={r.minGrossWeightKg != null ? formatKg(r.minGrossWeightKg) : "—"} hint="Unit weight × quantity, summed" />
          </dl>

          <h3 className="mt-6 text-heading text-text">Carrier options{destination ? ` · UK → ${destination}` : ""}</h3>
          <p className="mt-1 text-small text-muted" data-testid="calc-explanation">{c.explanation}</p>
          {c.status === "no_eligible" && c.requiredPallets != null && (
            <p className="mt-2 rounded-xl bg-red-bg px-3 py-2 text-small text-red-ink">No service can take this load on {pallets || "?"} pallet(s). At least {c.requiredPallets} pallets would fit.</p>
          )}
          {route.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-small" data-testid="carrier-table">
                <thead>
                  <tr className="text-left text-caption text-muted">
                    <th className="py-1 pr-3 font-normal">Service</th>
                    <th className="py-1 pr-3 text-right font-normal">Per pallet</th>
                    <th className="py-1 pr-3 text-right font-normal">Total</th>
                    <th className="py-1 pr-3 text-right font-normal">Transit</th>
                    <th className="py-1 pr-3 text-right font-normal">On time</th>
                    <th className="py-1 pr-3 text-right font-normal">Max kg/pallet</th>
                    <th className="py-1 font-normal">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {route.map((x) => {
                    const rec = c.recommendedKey === x.option.key;
                    return (
                      <tr key={x.option.key} className={cx("border-t border-rule", rec && "bg-pass-bg")} data-eligible={x.eligible} data-recommended={rec}>
                        <td className="py-2 pr-3 font-medium text-text">
                          {x.option.carrier} <span className="font-normal text-muted">{x.option.service}</span>
                        </td>
                        <td className="num py-2 pr-3 text-right">{formatGBP(x.option.pricePerPalletGBP)}</td>
                        <td className="num py-2 pr-3 text-right">{Number.isFinite(x.totalCostGBP) ? formatGBP(x.totalCostGBP) : "—"}</td>
                        <td className="num py-2 pr-3 text-right">{x.option.transitDays} days</td>
                        <td className="num py-2 pr-3 text-right">{x.option.onTimeRatePercent}%</td>
                        <td className="num py-2 pr-3 text-right">{formatKg(x.option.maxWeightPerPalletKg)}</td>
                        <td className="py-2 text-caption">
                          {c.kgPerPallet == null ? <span className="text-muted">—</span> : x.eligible ? <span className={rec ? "font-medium text-pass-ink" : "text-muted"}>{rec ? "Recommended" : "Eligible"}</span> : <span className="text-red-ink">Too heavy</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
