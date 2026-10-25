/**
 * The ten rulebook checks (R-01 … R-10). Pure functions; every result carries the numbers behind
 * the verdict and a concrete fix. A rule whose inputs are still unknown is `not_evaluable`,
 * never `pass`.
 */
import { ceilDiv, formatGBP, formatKg, formatNumber, ratio, toUnits, unitsToNumber } from "./decimal";
import { formatUK } from "./dates";
import { screenDescription } from "./hazmat";
import { RULE_BY_ID, type CarrierOption, type RuleId } from "./reference";
import type { CarrierAssessment, DraftBooking, DraftItem, RuleFinding, RuleResult } from "./schemas";

export type RuleContext = {
  todayUK: string;
  carrier: CarrierAssessment;
  options: readonly CarrierOption[];
};

function result(ruleId: RuleId, partial: Pick<RuleResult, "status" | "summary"> & Partial<RuleResult>): RuleResult {
  const def = RULE_BY_ID[ruleId];
  return {
    ruleId,
    severity: def.severity,
    title: def.title,
    description: def.description,
    findings: [],
    missingInputs: [],
    ...partial,
  };
}

function itemName(item: DraftItem, index: number): string {
  return item.sku ? `SKU ${item.sku}` : `Item ${index + 1}${item.description ? ` (${item.description})` : ""}`;
}

const n = (x: number) => formatNumber(x, 4);

/** Per-item rule helper: fail if any item fails, else not_evaluable if any item is unknown, else pass. */
function perItem(
  ruleId: RuleId,
  items: DraftItem[],
  check: (item: DraftItem, index: number) => { state: "pass" } | { state: "missing"; input: string } | { state: "fail"; finding: RuleFinding },
  passSummary: string,
): RuleResult {
  if (!items.length) return result(ruleId, { status: "not_evaluable", summary: "No item lines yet.", missingInputs: ["item lines"] });
  const findings: RuleFinding[] = [];
  const missing: string[] = [];
  items.forEach((item, i) => {
    const r = check(item, i);
    if (r.state === "fail") findings.push({ itemId: item.itemId, sku: item.sku, ...r.finding });
    else if (r.state === "missing") missing.push(`${itemName(item, i)}: ${r.input}`);
  });
  if (findings.length)
    return result(ruleId, {
      status: "fail",
      summary: findings.length === 1 ? findings[0].message : `${findings.length} items fail this check.`,
      findings,
      missingInputs: missing,
    });
  if (missing.length) return result(ruleId, { status: "not_evaluable", summary: `Waiting for ${missing.join("; ")}.`, missingInputs: missing });
  return result(ruleId, { status: "pass", summary: passSummary });
}

// R-01 ─────────────────────────────────────────────────────────────────────────
export function normalizeHsCode(raw: string): string {
  return raw.replace(/[\s.]/g, "");
}

export function ruleR01(b: DraftBooking): RuleResult {
  return perItem(
    "R-01",
    b.items,
    (item, i) => {
      if (item.hsCode === null) return { state: "missing", input: "HS code" };
      const code = normalizeHsCode(item.hsCode);
      if (/^\d{6,}$/.test(code)) return { state: "pass" };
      const digits = code.replace(/\D/g, "").length;
      const message = !code
        ? `${itemName(item, i)} has no HS code.`
        : /\D/.test(code)
          ? `${itemName(item, i)}: HS code "${item.hsCode}" contains non-digit characters.`
          : `${itemName(item, i)}: HS code ${code} has only ${digits} digit${digits === 1 ? "" : "s"}.`;
      return {
        state: "fail",
        finding: {
          message,
          actual: code ? `${code} (${digits} digits)` : "blank",
          expected: "at least 6 digits",
          fix: `Provide the verified HS code for ${itemName(item, i)} with at least 6 digits (e.g. from your commercial invoice or the UK Trade Tariff).`,
        },
      };
    },
    "Every item has an HS code of at least 6 digits.",
  );
}

// R-02 ─────────────────────────────────────────────────────────────────────────
export function ruleR02(b: DraftBooking): RuleResult {
  const missing: string[] = [];
  if (b.totalDeclaredValueGBP == null) missing.push("total declared value");
  if (!b.items.length) missing.push("item lines");
  b.items.forEach((item, i) => {
    if (item.quantityUnits == null) missing.push(`${itemName(item, i)}: quantity`);
    if (item.unitPriceGBP == null) missing.push(`${itemName(item, i)}: unit price`);
  });
  if (missing.length) return result("R-02", { status: "not_evaluable", summary: `Waiting for ${missing.join("; ")}.`, missingInputs: missing });

  const declared = toUnits(b.totalDeclaredValueGBP!);
  const sum = b.items.reduce((acc, it) => acc + BigInt(it.quantityUnits!) * toUnits(it.unitPriceGBP!), 0n);
  const diff = declared > sum ? declared - sum : sum - declared;
  const declaredStr = formatGBP(b.totalDeclaredValueGBP!);
  const sumStr = formatGBP(unitsToNumber(sum));
  const breakdown = b.items.map((it, i) => `${itemName(it, i)} ${n(it.quantityUnits!)} × ${formatGBP(it.unitPriceGBP!)}`).join(" + ");

  const pass = sum === 0n ? declared === 0n : diff * 100n <= sum;
  if (pass) {
    const pct = sum === 0n ? 0 : ratio(diff * 100n, sum, 2);
    return result("R-02", {
      status: "pass",
      summary: `Declared ${declaredStr} matches item total ${sumStr}${diff ? ` (difference ${pct}%, within 1%)` : ""}.`,
    });
  }
  const pct = sum === 0n ? null : ratio(diff * 100n, sum, 2);
  const low = unitsToNumber((sum * 99n) / 100n);
  const high = unitsToNumber((sum * 101n) / 100n);
  const message =
    `Declared ${declaredStr}, item sum ${sumStr}, ${formatGBP(unitsToNumber(diff))} difference` +
    (pct == null ? " (items total £0)." : ` (${pct}% of computed sum).`);
  return result("R-02", {
    status: "fail",
    summary: message,
    findings: [
      {
        message,
        actual: declaredStr,
        expected: sum === 0n ? "£0" : `${sumStr} (allowed ${formatGBP(low)} – ${formatGBP(high)})`,
        fix:
          `Item lines add up to ${sumStr} (${breakdown}). Change the declared value to ${sumStr}` +
          (sum === 0n ? "" : ` (anything from ${formatGBP(low)} to ${formatGBP(high)} passes)`) +
          `, or correct the item quantities/prices if the declared value is right.`,
      },
    ],
  });
}

// R-03 ─────────────────────────────────────────────────────────────────────────
export function ruleR03(b: DraftBooking): RuleResult {
  return perItem(
    "R-03",
    b.items,
    (item, i) => {
      const { quantityUnits: q, unitsPerCarton: u, cartons: c } = item;
      if (q == null || u == null || c == null)
        return { state: "missing", input: [q == null && "quantity", u == null && "units per carton", c == null && "cartons"].filter(Boolean).join(", ") };
      if (u * c === q) return { state: "pass" };
      const name = itemName(item, i);
      const exact = q % u === 0;
      const neededCartons = exact ? q / u : null;
      return {
        state: "fail",
        finding: {
          message: `${name} has ${n(q)} units but ${n(u)} × ${n(c)} = ${n(u * c)}.`,
          actual: `${n(u)} units/carton × ${n(c)} cartons = ${n(u * c)} units`,
          expected: `${n(q)} units (declared quantity)`,
          fix: exact
            ? `Update cartons to ${n(neededCartons!)} or quantity to ${n(u * c)}, after checking physical stock.`
            : `${n(q)} units is not a whole number of ${n(u)}-unit cartons (${formatNumber(q / u, 2)}). Check units per carton, or update quantity to ${n(u * c)} if ${n(c)} cartons is right, after checking physical stock.`,
        },
      };
    },
    "Every item's units per carton × cartons equals its quantity.",
  );
}

// R-04 ─────────────────────────────────────────────────────────────────────────
export function ruleR04(b: DraftBooking): RuleResult {
  const missing: string[] = [];
  if (b.cartons == null) missing.push("booking total cartons");
  if (!b.items.length) missing.push("item lines");
  b.items.forEach((it, i) => it.cartons == null && missing.push(`${itemName(it, i)}: cartons`));
  if (missing.length) return result("R-04", { status: "not_evaluable", summary: `Waiting for ${missing.join("; ")}.`, missingInputs: missing });
  const sum = b.items.reduce((a, it) => a + it.cartons!, 0);
  if (sum === b.cartons) return result("R-04", { status: "pass", summary: `Booking cartons ${n(sum)} equal the item total.` });
  const breakdown = b.items.map((it, i) => `${itemName(it, i)} ${n(it.cartons!)}`).join(" + ");
  const message = `Booking says ${n(b.cartons!)} cartons, item rows sum to ${n(sum)} (difference ${n(Math.abs(sum - b.cartons!))}).`;
  return result("R-04", {
    status: "fail",
    summary: message,
    findings: [
      {
        message,
        actual: `${n(b.cartons!)} cartons on booking`,
        expected: `${n(sum)} = ${breakdown}`,
        fix: `Set the booking's total cartons to ${n(sum)} if the item lines are right, or correct the item carton counts so they add up to ${n(b.cartons!)}.`,
      },
    ],
  });
}

// R-05 ─────────────────────────────────────────────────────────────────────────
export function ruleR05(b: DraftBooking, ctx: RuleContext): RuleResult {
  const a = ctx.carrier;
  if (b.pallets == null || b.totalGrossWeightKg == null || !b.destinationCountry) {
    return result("R-05", { status: "not_evaluable", summary: `Waiting for ${a.missingInputs.join(", ")}.`, missingInputs: a.missingInputs });
  }
  const perPallet = `${formatKg(b.totalGrossWeightKg)} ÷ ${b.pallets} pallet${b.pallets === 1 ? "" : "s"} = ${formatKg(a.kgPerPallet!)}/pallet`;
  const eligible = a.candidates.filter((c) => c.eligible);

  if (a.status === "no_eligible" && !a.selectedKey) {
    const maxOnRoute = Math.max(...a.candidates.map((c) => c.option.maxWeightPerPalletKg));
    const message = `${perPallet}. No service on UK → ${b.destinationCountry} accepts more than ${formatKg(maxOnRoute)}/pallet.`;
    return result("R-05", {
      status: "fail",
      summary: message,
      findings: [
        {
          message,
          actual: `${formatKg(a.kgPerPallet!)}/pallet`,
          expected: `≤ ${formatKg(maxOnRoute)}/pallet (highest limit on this route)`,
          fix: `Increase pallets to at least ${a.requiredPallets} (${formatNumber(b.totalGrossWeightKg)} ÷ ${formatNumber(maxOnRoute)}, rounded up) if the goods can be re-palletised, or reduce the shipment weight.`,
        },
      ],
    });
  }

  const chosen = a.candidates.find((c) => c.option.key === a.chosenKey);
  if (!chosen) {
    return result("R-05", {
      status: "not_evaluable",
      summary: "Waiting for the seller priority (or a chosen carrier) to know which carrier's limit applies.",
      missingInputs: ["seller priority"],
    });
  }
  const o = chosen.option;
  if (chosen.eligible) {
    return result("R-05", {
      status: "pass",
      summary: `${perPallet}, within ${o.carrier} ${o.service}'s ${formatKg(o.maxWeightPerPalletKg)} limit.`,
    });
  }
  const alt = [...eligible].sort((x, y) => x.totalCostGBP - y.totalCostGBP)[0];
  const neededForChosen = Number(ceilDiv(toUnits(b.totalGrossWeightKg), toUnits(o.maxWeightPerPalletKg)));
  const message = `${perPallet}. ${o.carrier} limit is ${formatNumber(o.maxWeightPerPalletKg)} kg.`;
  return result("R-05", {
    status: "fail",
    summary: message,
    findings: [
      {
        message,
        actual: `${formatKg(a.kgPerPallet!)}/pallet`,
        expected: `≤ ${formatKg(o.maxWeightPerPalletKg)}/pallet (${o.carrier} ${o.service})`,
        fix: alt
          ? `Select ${alt.option.carrier} ${alt.option.service} (${formatNumber(alt.option.maxWeightPerPalletKg)} kg limit, ${formatGBP(alt.totalCostGBP)}), or increase pallets to ${neededForChosen} to stay with ${o.carrier}.`
          : `Increase pallets to at least ${a.requiredPallets ?? neededForChosen}, if the goods can be re-palletised.`,
      },
    ],
  });
}

// R-06 ─────────────────────────────────────────────────────────────────────────
export function ruleR06(b: DraftBooking): RuleResult {
  return perItem(
    "R-06",
    b.items,
    (item, i) => {
      if (item.description == null && item.sku == null) return { state: "missing", input: "description" };
      const screen = screenDescription(`${item.description ?? ""} ${item.sku ?? ""}`);
      if (!screen.matches.length) return { state: "pass" };
      const cats = [...new Set(screen.matches.map((m) => m.category))];
      const phrases = screen.matches.map((m) => `"${m.phrase}"`).join(", ");
      return {
        state: "fail",
        finding: {
          message: `${itemName(item, i)} looks like a prohibited item (${cats.join(", ")}): matched ${phrases}.`,
          actual: item.description ?? item.sku ?? "",
          expected: "No lithium batteries, aerosols or flammable liquids",
          fix: `Remove ${itemName(item, i)} from this shipment. If the description is misleading (e.g. the product contains no battery), correct the description.`,
        },
      };
    },
    "No item description matches lithium batteries, aerosols or flammable liquids.",
  );
}

/** Unscored clarification cues for ambiguous wording (not a rule failure). */
export function hazardNotes(b: DraftBooking): string[] {
  const notes: string[] = [];
  b.items.forEach((item, i) => {
    const s = screenDescription(`${item.description ?? ""}`);
    if (!s.matches.length && s.ambiguous.length)
      notes.push(`${itemName(item, i)} mentions "${s.ambiguous.join('", "')}". If it contains lithium batteries, aerosols or flammable liquids it cannot ship — please confirm.`);
  });
  return notes;
}

// R-07 ─────────────────────────────────────────────────────────────────────────
export function ruleR07(b: DraftBooking): RuleResult {
  const missing: string[] = [];
  if (b.totalGrossWeightKg == null) missing.push("total gross weight");
  if (!b.items.length) missing.push("item lines");
  b.items.forEach((it, i) => {
    if (it.unitWeightKg == null) missing.push(`${itemName(it, i)}: unit weight`);
    if (it.quantityUnits == null) missing.push(`${itemName(it, i)}: quantity`);
  });
  if (missing.length) return result("R-07", { status: "not_evaluable", summary: `Waiting for ${missing.join("; ")}.`, missingInputs: missing });
  const gross = toUnits(b.totalGrossWeightKg!);
  const product = b.items.reduce((a, it) => a + BigInt(it.quantityUnits!) * toUnits(it.unitWeightKg!), 0n);
  const productKg = unitsToNumber(product);
  if (gross >= product)
    return result("R-07", { status: "pass", summary: `Gross ${formatKg(b.totalGrossWeightKg!)} ≥ product weight ${formatKg(productKg)}.` });
  const breakdown = b.items.map((it, i) => `${itemName(it, i)} ${n(it.quantityUnits!)} × ${formatKg(it.unitWeightKg!)}`).join(" + ");
  const message = `Gross ${formatKg(b.totalGrossWeightKg!)} below product weight ${formatKg(productKg)}.`;
  return result("R-07", {
    status: "fail",
    summary: message,
    findings: [
      {
        message,
        actual: formatKg(b.totalGrossWeightKg!),
        expected: `≥ ${formatKg(productKg)} (${breakdown})`,
        fix: `Re-weigh or correct the gross weight — it includes cartons and pallets, so it should be at least ${formatKg(productKg)} — or correct the item unit weights/quantities.`,
      },
    ],
  });
}

// R-08 ─────────────────────────────────────────────────────────────────────────
export function ruleR08(b: DraftBooking): RuleResult {
  if (!b.destinationType) return result("R-08", { status: "not_evaluable", summary: "Waiting for destination type.", missingInputs: ["destination type"] });
  if (b.destinationType === "Business address")
    return result("R-08", { status: "pass", summary: "Business address — no delivery appointment required." });
  if (b.deliveryAppointmentBooked == null)
    return result("R-08", { status: "not_evaluable", summary: "Waiting to know whether a warehouse delivery appointment is booked.", missingInputs: ["delivery appointment"] });
  if (b.deliveryAppointmentBooked) return result("R-08", { status: "pass", summary: "Warehouse delivery appointment is booked." });
  const message = "Warehouse destination has no delivery appointment booked.";
  return result("R-08", {
    status: "fail",
    summary: message,
    findings: [
      {
        message,
        actual: "Delivery appointment booked: No",
        expected: "Yes for Warehouse destinations",
        fix: `Book a delivery slot with the receiving warehouse${b.destinationCity ? ` in ${b.destinationCity}` : ""}, then update the booking to Yes.`,
      },
    ],
  });
}

// R-09 ─────────────────────────────────────────────────────────────────────────
export function ruleR09(b: DraftBooking): RuleResult {
  return perItem(
    "R-09",
    b.items,
    (item, i) => {
      if (item.countryOfOrigin === null) return { state: "missing", input: "country of origin" };
      if (item.countryOfOrigin.trim()) return { state: "pass" };
      return {
        state: "fail",
        finding: {
          message: `${itemName(item, i)} is missing its country of origin.`,
          actual: "blank",
          expected: "Country where the product was made",
          fix: `Add the manufacturing country of origin for ${itemName(item, i)} (where it was made, not where it ships from).`,
        },
      };
    },
    "Every item has a country of origin.",
  );
}

// R-10 ─────────────────────────────────────────────────────────────────────────
export function ruleR10(b: DraftBooking, ctx: RuleContext): RuleResult {
  if (!b.readyToShipDate) return result("R-10", { status: "not_evaluable", summary: "Waiting for ready-to-ship date.", missingInputs: ["ready-to-ship date"] });
  const d = b.readyToShipDate;
  if (d >= ctx.todayUK)
    return result("R-10", {
      status: "pass",
      summary: `Ready date ${formatUK(d)} is ${d === ctx.todayUK ? "today" : "in the future"} (UK date today ${formatUK(ctx.todayUK)}).`,
    });
  const message = `Ready date ${formatUK(d)} is in the past (today is ${formatUK(ctx.todayUK)}, UK time).`;
  return result("R-10", {
    status: "fail",
    summary: message,
    findings: [
      {
        message,
        actual: formatUK(d),
        expected: `${formatUK(ctx.todayUK)} or later`,
        fix:
          b.readyDateNote === "confirm_year"
            ? `I assumed ${d.slice(0, 4)} because no year was given. If you meant next year, say so; otherwise enter the date the goods will actually be ready.`
            : "Enter the date the goods will actually be packed and ready for collection (today or later).",
      },
    ],
  });
}

export function runAllRules(b: DraftBooking, ctx: RuleContext): RuleResult[] {
  return [
    ruleR01(b),
    ruleR02(b),
    ruleR03(b),
    ruleR04(b),
    ruleR05(b, ctx),
    ruleR06(b),
    ruleR07(b),
    ruleR08(b),
    ruleR09(b),
    ruleR10(b, ctx),
  ];
}
