"use client";

import { useState } from "react";
import { formatLong, formatUK } from "@/lib/domain/dates";
import { formatGBP, formatKg, formatNumber } from "@/lib/domain/decimal";
import type { CarrierAssessment, DraftBooking, DraftItem, Evaluation, InputIssue, RuleResult } from "@/lib/client/types";
import { Glyph, RuleChip, StatusPill, cx, ruleState } from "../ui";

const CELL: Record<string, string> = {
  pass: "bg-pass-bg text-pass-ink",
  red: "bg-red-bg text-red-ink",
  amber: "bg-amber-bg text-amber-ink",
  na: "bg-na-bg text-na-ink",
};
const WORD: Record<string, string> = { pass: "Pass", red: "Must fix", amber: "Check", na: "Not evaluable" };

/** Signature element: all ten rulebook checks at a glance. */
export function PreflightStrip({ rules, onSelect }: { rules: RuleResult[]; onSelect?: (id: string) => void }) {
  return (
    <ol className="grid grid-cols-10 gap-1" aria-label="Pre-flight checks R-01 to R-10" data-testid="preflight-strip">
      {rules.map((r) => {
        const s = ruleState(r);
        return (
          <li key={r.ruleId}>
            <button
              type="button"
              onClick={() => onSelect?.(r.ruleId)}
              title={`${r.ruleId} ${r.title}: ${WORD[s]}`}
              aria-label={`${r.ruleId} ${r.title}: ${WORD[s]}`}
              className={cx("flex h-11 w-full flex-col items-center justify-center rounded-md text-caption leading-none", CELL[s])}
            >
              <Glyph kind={s} className="size-3" />
              <span className="mt-1 font-mono">{r.ruleId.slice(2)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

const isFailing = (r: RuleResult) => ruleState(r) === "red" || ruleState(r) === "amber";

/** Failing checks first, each with what is wrong and how to fix it. `filter` lets a view split failing from passing. */
export function RuleChecklist({ rules, highlight, filter = "all" }: { rules: RuleResult[]; highlight?: string | null; filter?: "all" | "failing" | "passing" }) {
  const order = (r: RuleResult) => ({ red: 0, amber: 1, na: 2, pass: 3 })[ruleState(r)];
  const sorted = [...rules]
    .filter((r) => (filter === "all" ? true : filter === "failing" ? isFailing(r) : !isFailing(r)))
    .sort((a, b) => order(a) - order(b) || a.ruleId.localeCompare(b.ruleId));
  return (
    <ul className="divide-y divide-rule" data-testid="rule-checklist">
      {sorted.map((r) => {
        const s = ruleState(r);
        return (
          <li key={r.ruleId} id={`rule-${r.ruleId}`} className={cx("py-2.5", highlight === r.ruleId && "rounded-md bg-accent-soft/60")} data-rule={r.ruleId} data-state={s}>
            <div className="flex items-start gap-2">
              <span className="w-10 flex-none pt-0.5 font-mono text-caption text-muted">{r.ruleId}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-small font-medium text-text">{r.title}</span>
                  <RuleChip state={s} />
                  {s !== "pass" && s !== "na" ? null : <span className="text-caption text-faint">{r.severity === "Red" ? "Must fix" : "Check"} if broken</span>}
                </div>
                {s === "pass" || s === "na" ? (
                  <p className="mt-0.5 text-small text-muted">{r.summary}</p>
                ) : (
                  <ul className="mt-1.5 space-y-2">
                    {r.findings.map((f, i) => (
                      <li key={i} className="rounded-lg bg-raised px-3 py-2">
                        <p className="text-small text-text">{f.message}</p>
                        {(f.actual || f.expected) && (
                          <dl className="mt-1.5 grid grid-cols-[68px_1fr] gap-x-2 gap-y-0.5 text-caption">
                            {f.actual && (
                              <>
                                <dt className="text-muted">Actual</dt>
                                <dd className="num text-text">{f.actual}</dd>
                              </>
                            )}
                            {f.expected && (
                              <>
                                <dt className="text-muted">Expected</dt>
                                <dd className="num text-text">{f.expected}</dd>
                              </>
                            )}
                          </dl>
                        )}
                        <p className="mt-1.5 text-small text-text">
                          <span className="font-medium">To fix: </span>
                          {f.fix}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Signature element: this load's kg per pallet against each service's limit on the route. */
export function WeightGauge({ carrier }: { carrier: CarrierAssessment }) {
  if (carrier.kgPerPallet == null || !carrier.candidates.length) return null;
  const maxLimit = Math.max(...carrier.candidates.map((c) => c.option.maxWeightPerPalletKg));
  const scale = Math.max(maxLimit, carrier.kgPerPallet) * 1.1;
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const over = carrier.kgPerPallet > maxLimit;
  return (
    <figure className="mt-3" aria-label={`Load is ${formatKg(carrier.kgPerPallet)} per pallet`}>
      <div className="flex items-baseline justify-between text-caption text-muted">
        <span>Weight per pallet</span>
        <span className={cx("num font-medium", over ? "text-negative" : "text-text")}>{formatKg(carrier.kgPerPallet)}</span>
      </div>
      <div className="relative mt-2 h-8">
        <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-rule" />
        <div className={cx("absolute top-3 left-0 h-2 rounded-full", over ? "bg-negative" : "bg-accent")} style={{ width: pct(carrier.kgPerPallet) }} />
        {[...new Set(carrier.candidates.map((c) => c.option.maxWeightPerPalletKg))].map((limit) => (
          <div key={limit} className="absolute top-1 h-6" style={{ left: pct(limit) }}>
            <div className="h-6 w-px bg-ink/60" />
          </div>
        ))}
      </div>
      <figcaption className="relative h-4 text-caption text-muted">
        {carrier.candidates
          .filter((c, i, arr) => arr.findIndex((x) => x.option.maxWeightPerPalletKg === c.option.maxWeightPerPalletKg) === i)
          .map((c) => (
            <span key={c.option.key} className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(c.option.maxWeightPerPalletKg) }}>
              {c.option.carrier.replace("Carrier ", "")} {formatNumber(c.option.maxWeightPerPalletKg)}
            </span>
          ))}
      </figcaption>
    </figure>
  );
}

export function CarrierPanel({ carrier, status, timeline }: { carrier: CarrierAssessment; status: string; timeline: Evaluation["timeline"] }) {
  const chosen = carrier.candidates.find((c) => c.option.key === carrier.chosenKey);
  const tentative = status === "Blocked" || status === "Draft";
  return (
    <div data-testid="carrier-panel">
      {chosen ? (
        <div className="rounded-2xl bg-raised p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-caption text-muted">
                {carrier.selectedKey === chosen.option.key ? "Your chosen carrier" : "Recommended"}
                {carrier.priority ? ` · ${carrier.priority}` : ""}
                {tentative ? " · tentative" : ""}
              </p>
              <p className="mt-0.5 text-card text-text">
                {chosen.option.carrier} <span className="font-normal text-muted">{chosen.option.service}</span>
              </p>
            </div>
            <p className="num text-right text-figure text-accent-ink" data-testid="carrier-cost">
              {formatGBP(chosen.totalCostGBP)}
            </p>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-caption">
            <div>
              <dt className="text-muted">Per pallet</dt>
              <dd className="num text-text">
                {carrier.pallets} × {formatGBP(chosen.option.pricePerPalletGBP)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Transit</dt>
              <dd className="num text-text">{chosen.option.transitDays} days</dd>
            </div>
            <div>
              <dt className="text-muted">On time</dt>
              <dd className="num text-text">{chosen.option.onTimeRatePercent}%</dd>
            </div>
          </dl>
          {!chosen.eligible && <p className="mt-2 text-small text-red-ink">This service can&apos;t take {formatKg(carrier.kgPerPallet ?? 0)}/pallet — see R-05.</p>}
          {timeline && (
            <p className="mt-2 text-caption text-muted">
              Proposed collection {formatLong(timeline.proposedCollectionDate)}
              {timeline.indicativeDeliveryDate ? ` · indicative delivery ${formatLong(timeline.indicativeDeliveryDate)}` : ""}
            </p>
          )}
        </div>
      ) : (
        <p className={cx("rounded-lg px-3 py-2 text-small", carrier.status === "no_eligible" ? "bg-red-bg text-red-ink" : "bg-raised text-muted")}>
          {carrier.status === "no_eligible" ? "No eligible carrier on this route. " : ""}
          {carrier.status === "no_eligible" ? `Suggested: at least ${carrier.requiredPallets} pallets.` : carrier.explanation}
        </p>
      )}
      {carrier.status !== "not_evaluable" || carrier.kgPerPallet != null ? <WeightGauge carrier={carrier} /> : null}
      {(chosen || carrier.status === "no_eligible") && <p className="mt-3 text-small leading-5 text-text">{carrier.explanation}</p>}
      {carrier.candidates.length > 0 && carrier.pallets != null && (
        <table className="mt-3 w-full text-caption">
          <caption className="sr-only">Carrier options on this route</caption>
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-normal">Service</th>
              <th className="py-1 text-right font-normal">Cost</th>
              <th className="py-1 text-right font-normal">Days</th>
              <th className="py-1 text-right font-normal">On time</th>
              <th className="py-1 text-right font-normal">Max kg</th>
            </tr>
          </thead>
          <tbody>
            {carrier.candidates.map((c) => (
              <tr key={c.option.key} className={cx("border-t border-rule", !c.eligible && "text-faint")}>
                <td className="py-1.5">
                  <span className={cx(c.option.key === carrier.chosenKey ? "font-medium text-text" : "")}>{c.option.carrier}</span>
                  <span className="text-muted"> {c.option.service}</span>
                  {!c.eligible && <span className="block text-caption text-red-ink">Excluded: over weight limit</span>}
                </td>
                <td className="num py-1.5 text-right">{formatGBP(c.totalCostGBP)}</td>
                <td className="num py-1.5 text-right">{c.option.transitDays}</td>
                <td className="num py-1.5 text-right">{c.option.onTimeRatePercent}%</td>
                <td className="num py-1.5 text-right">{formatNumber(c.option.maxWeightPerPalletKg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function V({ v, missing }: { v: string | null; missing?: boolean }) {
  if (v === null || v === "") return <span className={cx("text-faint", missing && "text-amber-ink")}>{missing ? "Missing" : "—"}</span>;
  return <span className="text-text">{v}</span>;
}

export function FactsList({ draft, missingKeys }: { draft: DraftBooking; missingKeys: Set<string> }) {
  const d = draft;
  const rows: [string, string | null, string][] = [
    ["Seller", d.sellerName, "sellerName"],
    ["From", d.originCity ? `${d.originCity}, United Kingdom` : null, "originCity"],
    ["To", d.destinationCity || d.destinationCountry ? [d.destinationCity, d.destinationCountry].filter(Boolean).join(", ") : null, "destinationCity"],
    ["Destination type", d.destinationType, "destinationType"],
    ["Ready to ship", d.readyToShipDate ? `${formatUK(d.readyToShipDate)}${d.readyDateNote === "year_assumed" ? " (year assumed)" : d.readyDateNote === "confirm_year" ? " (confirm year)" : ""}` : null, "readyToShipDate"],
    ["Priority", d.sellerPriority, "sellerPriority"],
    ["Pallets", d.pallets != null ? formatNumber(d.pallets) : null, "pallets"],
    ["Total cartons", d.cartons != null ? formatNumber(d.cartons) : null, "cartons"],
    ["Gross weight", d.totalGrossWeightKg != null ? formatKg(d.totalGrossWeightKg) : null, "totalGrossWeightKg"],
    ["Declared value", d.totalDeclaredValueGBP != null ? formatGBP(d.totalDeclaredValueGBP) : null, "totalDeclaredValueGBP"],
    ["Delivery appointment", d.deliveryAppointmentBooked == null ? (d.destinationType === "Business address" ? "Not required" : null) : d.deliveryAppointmentBooked ? "Booked" : "Not booked", "deliveryAppointmentBooked"],
  ];
  return (
    <dl className="grid grid-cols-[132px_1fr] gap-x-3 text-small" data-testid="booking-facts">
      {rows.map(([label, value, key]) => (
        <div key={label} className="contents">
          <dt className="border-t border-rule py-1.5 text-muted first:border-t-0">{label}</dt>
          <dd className="num border-t border-rule py-1.5" data-field={key}>
            <V v={value} missing={missingKeys.has(key)} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ItemsTable({ items, showRows }: { items: DraftItem[]; showRows?: boolean }) {
  if (!items.length) return <p className="text-small text-muted">No product lines yet.</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[560px] text-caption" data-testid="items-table">
        <thead>
          <tr className="text-left text-muted">
            {showRows && <th className="py-1 pr-2 font-normal">Row</th>}
            <th className="py-1 pr-2 font-normal">SKU / description</th>
            <th className="py-1 pr-2 font-normal">HS code</th>
            <th className="py-1 pr-2 text-right font-normal">Qty</th>
            <th className="py-1 pr-2 text-right font-normal">Unit £</th>
            <th className="py-1 pr-2 text-right font-normal">Per ctn × ctns</th>
            <th className="py-1 pr-2 text-right font-normal">Unit kg</th>
            <th className="py-1 font-normal">Origin</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.itemId} className="border-t border-rule align-top">
              {showRows && <td className="num py-1.5 pr-2 text-muted">{it.sourceRow ?? "—"}</td>}
              <td className="py-1.5 pr-2">
                <span className="font-mono text-text">{it.sku ?? "—"}</span>
                <span className="block max-w-[220px] truncate text-muted">{it.description ?? "—"}</span>
              </td>
              <td className="py-1.5 pr-2 font-mono">{it.hsCode === null ? <span className="text-faint">—</span> : it.hsCode === "" ? <span className="text-red-ink">blank</span> : it.hsCode}</td>
              <td className="num py-1.5 pr-2 text-right">{it.quantityUnits != null ? formatNumber(it.quantityUnits) : "—"}</td>
              <td className="num py-1.5 pr-2 text-right">{it.unitPriceGBP != null ? formatGBP(it.unitPriceGBP) : "—"}</td>
              <td className="num py-1.5 pr-2 text-right">
                {it.unitsPerCarton ?? "—"} × {it.cartons ?? "—"}
              </td>
              <td className="num py-1.5 pr-2 text-right">{it.unitWeightKg != null ? formatNumber(it.unitWeightKg, 4) : "—"}</td>
              <td className="py-1.5">{it.countryOfOrigin === null ? <span className="text-faint">—</span> : it.countryOfOrigin === "" ? <span className="text-amber-ink">blank</span> : it.countryOfOrigin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NextSteps({ evaluation }: { evaluation: Evaluation }) {
  return (
    <ul className="space-y-1.5 text-small leading-5 text-text" data-testid="next-steps">
      {evaluation.nextSteps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-2 size-1 flex-none rounded-full bg-muted" />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

export function InputIssues({ issues }: { issues: InputIssue[] }) {
  const shown = issues.filter((i) => i.severity !== "info");
  if (!shown.length) return null;
  return (
    <ul className="space-y-1.5" data-testid="input-issues">
      {shown.map((i, n) => (
        <li key={n} className={cx("rounded-lg px-3 py-2 text-small", i.severity === "error" ? "bg-red-bg text-red-ink" : "bg-amber-bg text-amber-ink")}>
          <span className="font-medium">{i.severity === "error" ? "Input issue" : "Warning"}</span>
          {i.row ? <span className="num"> · {i.sheet} row {i.row}</span> : null}
          {i.column ? <span> · {i.column}</span> : null}
          <span className="block text-text">{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatusSummary({ evaluation, revision, saved }: { evaluation: Evaluation; revision?: number; saved?: "saved" | "saving" | "unsaved" }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={evaluation.status} />
        <span className="num text-small text-muted">
          {evaluation.redCount} to fix · {evaluation.amberCount} to check
        </span>
        {revision !== undefined && (
          <span className={cx("num ml-auto text-caption", saved === "unsaved" ? "text-red-ink" : "text-muted")} data-testid="revision">
            {saved === "saving" ? "Saving…" : saved === "unsaved" ? "Not saved" : `Saved · rev ${revision}`}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-small text-text" data-testid="headline">{evaluation.headline}</p>
    </div>
  );
}

export function Collapsible({ title, count, children, defaultOpen = true }: { title: string; count?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-border">
      <h3>
        <button type="button" className="flex w-full items-center justify-between py-3 text-left text-small font-semibold text-text" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>
            {title}
            {count && <span className="num ml-1.5 font-normal text-muted">{count}</span>}
          </span>
          <svg viewBox="0 0 16 16" className={cx("size-3.5 text-muted transition-transform", open && "rotate-180")} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h3>
      {open && <div className="pb-4">{children}</div>}
    </section>
  );
}

/** The first thing a user needs on any booking: what is wrong, and how to put it right. Hidden when nothing fails. */
export function FixList({ rules, highlight }: { rules: RuleResult[]; highlight?: string | null }) {
  const failing = rules.filter(isFailing);
  if (!failing.length) return null;
  return (
    <section aria-labelledby="fix-first-h" data-testid="fix-list">
      <h2 id="fix-first-h" className="text-heading text-text">
        Fix these first <span className="num font-normal text-muted">{failing.length}</span>
      </h2>
      <div className="mt-2">
        <RuleChecklist rules={rules} filter="failing" highlight={highlight} />
      </div>
    </section>
  );
}
