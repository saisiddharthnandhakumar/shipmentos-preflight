/**
 * Carrier eligibility and ranking. Route and weight filters run BEFORE any ranking, so a service
 * whose max kg/pallet is exceeded can never be recommended, however cheap or fast.
 */
import { ceilDiv, formatGBP, formatKg, formatNumber, ratio, toUnits, unitsToNumber } from "./decimal";
import type { CarrierOption, DestinationCountry, SellerPriority } from "./reference";
import type { CarrierAssessment, CarrierCandidate } from "./schemas";

export type CarrierInput = {
  destinationCountry: DestinationCountry | null;
  pallets: number | null;
  totalGrossWeightKg: number | null;
  sellerPriority: SellerPriority | null;
  selectedCarrierKey: string | null;
};

export const BALANCED_WEIGHTS = { cost: 0.4, speed: 0.3, reliability: 0.3 } as const;

function label(o: CarrierOption): string {
  return `${o.carrier} ${o.service}`;
}

function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable tie-break chain: cheaper → faster → more reliable → stable key. */
function tieBreak(a: CarrierCandidate, b: CarrierCandidate): number {
  return (
    cmpNum(a.totalCostGBP, b.totalCostGBP) ||
    cmpNum(a.option.transitDays, b.option.transitDays) ||
    cmpNum(b.option.onTimeRatePercent, a.option.onTimeRatePercent) ||
    (a.option.key < b.option.key ? -1 : a.option.key > b.option.key ? 1 : 0)
  );
}

/** Min–max normalised benefit within the eligible set; 0.5 when every option ties on that dimension. */
function benefit(value: number, min: number, max: number, higherIsBetter: boolean): number {
  if (max === min) return 0.5;
  return higherIsBetter ? (value - min) / (max - min) : (max - value) / (max - min);
}

export function balancedScores(eligible: CarrierCandidate[]): Map<string, { score: number; cost: number; speed: number; reliability: number }> {
  const costs = eligible.map((c) => c.totalCostGBP);
  const days = eligible.map((c) => c.option.transitDays);
  const rates = eligible.map((c) => c.option.onTimeRatePercent);
  const [minC, maxC, minD, maxD, minR, maxR] = [
    Math.min(...costs), Math.max(...costs), Math.min(...days), Math.max(...days), Math.min(...rates), Math.max(...rates),
  ];
  const out = new Map<string, { score: number; cost: number; speed: number; reliability: number }>();
  for (const c of eligible) {
    const cost = benefit(c.totalCostGBP, minC, maxC, false);
    const speed = benefit(c.option.transitDays, minD, maxD, false);
    const reliability = benefit(c.option.onTimeRatePercent, minR, maxR, true);
    const score = BALANCED_WEIGHTS.cost * cost + BALANCED_WEIGHTS.speed * speed + BALANCED_WEIGHTS.reliability * reliability;
    out.set(c.option.key, { score: Math.round(score * 10_000) / 10_000, cost, speed, reliability });
  }
  return out;
}

export function rankEligible(eligible: CarrierCandidate[], priority: SellerPriority): CarrierCandidate[] {
  const list = [...eligible];
  if (priority === "Cheapest") list.sort(tieBreak);
  else if (priority === "Fastest")
    list.sort((a, b) => cmpNum(a.option.transitDays, b.option.transitDays) || tieBreak(a, b));
  else if (priority === "Most reliable")
    list.sort((a, b) => cmpNum(b.option.onTimeRatePercent, a.option.onTimeRatePercent) || tieBreak(a, b));
  else {
    const scores = balancedScores(list);
    for (const c of list) c.score = scores.get(c.option.key)!.score;
    list.sort((a, b) => cmpNum(b.score!, a.score!) || tieBreak(a, b));
  }
  list.forEach((c, i) => (c.rank = i + 1));
  return list;
}

export function assessCarriers(input: CarrierInput, options: readonly CarrierOption[]): CarrierAssessment {
  const { destinationCountry, pallets, totalGrossWeightKg: gross, sellerPriority: priority } = input;
  const missingInputs: string[] = [];
  if (!destinationCountry) missingInputs.push("destination country");
  if (pallets == null) missingInputs.push("pallets");
  if (gross == null) missingInputs.push("total gross weight");

  const route = destinationCountry ? options.filter((o) => o.destinationCountry === destinationCountry) : [];
  const selected = input.selectedCarrierKey ? route.find((o) => o.key === input.selectedCarrierKey) ?? null : null;

  const base: CarrierAssessment = {
    status: "not_evaluable",
    priority,
    pallets,
    grossWeightKg: gross,
    kgPerPallet: null,
    candidates: route.map((option) => ({
      option,
      totalCostGBP: pallets != null ? unitsToNumber(toUnits(option.pricePerPalletGBP) * BigInt(pallets)) : NaN,
      eligible: false,
      exclusionReason: null,
      score: null,
      rank: null,
    })),
    recommendedKey: null,
    selectedKey: selected?.key ?? null,
    chosenKey: null,
    explanation: "",
    requiredPallets: null,
    missingInputs,
  };

  if (missingInputs.length || pallets == null || gross == null || !destinationCountry) {
    base.explanation = `Carrier options appear once we know the ${missingInputs.join(", ")}.`;
    return base;
  }
  if (pallets <= 0) {
    base.explanation = "Pallets must be at least 1 to compare carriers.";
    base.missingInputs = ["pallets"];
    return base;
  }

  const grossU = toUnits(gross);
  const palletsB = BigInt(pallets);
  const kgPerPallet = ratio(grossU, palletsB * 10_000n, 2);
  base.kgPerPallet = kgPerPallet;

  for (const c of base.candidates) {
    const maxU = toUnits(c.option.maxWeightPerPalletKg);
    c.eligible = grossU <= maxU * palletsB; // exact: gross/pallets <= max  ⇔  gross <= max × pallets
    c.exclusionReason = c.eligible
      ? null
      : `${formatKg(kgPerPallet)}/pallet exceeds its ${formatKg(c.option.maxWeightPerPalletKg)} limit`;
  }
  const eligible = base.candidates.filter((c) => c.eligible);
  const excluded = base.candidates.filter((c) => !c.eligible);
  const exclusionText = excluded.length
    ? ` Excluded: ${excluded.map((c) => `${label(c.option)} (${c.exclusionReason})`).join("; ")}.`
    : "";

  if (!eligible.length) {
    const maxOnRoute = Math.max(...route.map((o) => o.maxWeightPerPalletKg));
    const required = Number(ceilDiv(grossU, toUnits(maxOnRoute)));
    base.status = "no_eligible";
    base.requiredPallets = required;
    base.explanation =
      `${formatKg(gross)} ÷ ${pallets} pallet${pallets === 1 ? "" : "s"} = ${formatKg(kgPerPallet)}/pallet, which exceeds every service on UK → ${destinationCountry} ` +
      `(highest limit ${formatKg(maxOnRoute)}). No carrier can be recommended. Spreading the load over at least ${required} pallets ` +
      `(${formatNumber(gross)} ÷ ${formatNumber(maxOnRoute)}, rounded up) would fit, if the goods can physically be re-palletised.`;
    if (selected) base.chosenKey = selected.key;
    return base;
  }

  if (!priority) {
    base.status = "not_evaluable";
    base.missingInputs = ["seller priority"];
    base.chosenKey = selected?.key ?? null;
    base.explanation =
      `${eligible.length} of ${route.length} services can carry ${formatKg(kgPerPallet)}/pallet. Tell me the seller priority (Cheapest, Fastest, Most reliable or Balanced) to rank them.` +
      exclusionText;
    return base;
  }

  const ranked = rankEligible(eligible, priority);
  const best = ranked[0];
  base.status = "recommended";
  base.recommendedKey = best.option.key;
  base.chosenKey = selected?.key ?? best.option.key;
  base.explanation = explain(priority, ranked, pallets) + exclusionText;
  if (selected && selected.key !== best.option.key) {
    const sel = base.candidates.find((c) => c.option.key === selected.key)!;
    base.explanation += sel.eligible
      ? ` You chose ${label(selected)} (${formatGBP(sel.totalCostGBP)}, ${selected.transitDays} days, ${selected.onTimeRatePercent}% on time); checks use your choice.`
      : ` You chose ${label(selected)}, but it cannot take ${formatKg(kgPerPallet)}/pallet (limit ${formatKg(selected.maxWeightPerPalletKg)}).`;
  }
  return base;
}

function explain(priority: SellerPriority, ranked: CarrierCandidate[], pallets: number): string {
  const [best, ...rest] = ranked;
  const o = best.option;
  const facts = `${pallets} × ${formatGBP(o.pricePerPalletGBP)} = ${formatGBP(best.totalCostGBP)}, ${o.transitDays} days transit, ${o.onTimeRatePercent}% on time`;
  const others = rest
    .map((c) => `${label(c.option)} ${formatGBP(c.totalCostGBP)} / ${c.option.transitDays} days / ${c.option.onTimeRatePercent}%`)
    .join("; ");
  const vs = others ? ` Other eligible: ${others}.` : " It is the only eligible service.";
  switch (priority) {
    case "Cheapest":
      return `${label(o)} is the cheapest eligible service: ${facts}.${vs}`;
    case "Fastest":
      return `${label(o)} is the fastest eligible service: ${facts}.${vs}`;
    case "Most reliable":
      return `${label(o)} has the highest on-time rate among eligible services: ${facts}.${vs}`;
    case "Balanced": {
      const scores = rest.map((c) => `${label(c.option)} ${c.score!.toFixed(2)}`).join(", ");
      return (
        `${label(o)} has the best balanced score ${best.score!.toFixed(2)} (40% cost, 30% speed, 30% reliability, scaled across eligible options): ${facts}.` +
        (scores ? ` Other scores: ${scores}.` : " It is the only eligible service.")
      );
    }
  }
}

export function carrierLabel(o: CarrierOption): string {
  return label(o);
}
