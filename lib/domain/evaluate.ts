/**
 * The single entry point both modes use: canonical draft (+ optional input issues) → evaluation.
 */
import { assessCarriers } from "./carriers";
import { addDays, formatLong, formatUK } from "./dates";
import { formatGBP } from "./decimal";
import { missingFields } from "./missing";
import {
  CARRIER_OPTIONS,
  ENGINE_VERSION,
  RATE_CARD_VERSION,
  RULEBOOK_VERSION,
  type CarrierOption,
} from "./reference";
import { hazardNotes, runAllRules } from "./rules";
import type { DraftBooking, Evaluation, InputIssue, ShipmentStatus } from "./schemas";

export type EvaluateOptions = {
  todayUK: string;
  options?: readonly CarrierOption[];
  inputIssues?: InputIssue[];
};

export function evaluateBooking(b: DraftBooking, opts: EvaluateOptions): Evaluation {
  const options = opts.options ?? CARRIER_OPTIONS;
  const inputIssues = opts.inputIssues ?? [];
  const carrier = assessCarriers(
    {
      destinationCountry: b.destinationCountry,
      pallets: b.pallets,
      totalGrossWeightKg: b.totalGrossWeightKg,
      sellerPriority: b.sellerPriority,
      selectedCarrierKey: b.selectedCarrierKey,
    },
    options,
  );
  const rules = runAllRules(b, { todayUK: opts.todayUK, carrier, options });
  const missing = missingFields(b);
  const red = rules.filter((r) => r.status === "fail" && r.severity === "Red");
  const amber = rules.filter((r) => r.status === "fail" && r.severity === "Amber");
  const inputErrors = inputIssues.filter((i) => i.severity === "error");

  let status: ShipmentStatus;
  if (inputErrors.length) status = "Blocked";
  else if (missing.length) status = "Draft";
  else if (red.length) status = "Blocked";
  else if (amber.length) status = "Needs attention";
  else status = "Ready to submit";

  const chosen = carrier.candidates.find((c) => c.option.key === carrier.chosenKey) ?? null;
  const timeline = b.readyToShipDate
    ? (() => {
        const collection = b.readyToShipDate! >= opts.todayUK ? b.readyToShipDate! : opts.todayUK;
        return {
          proposedCollectionDate: collection,
          indicativeDeliveryDate: chosen ? addDays(collection, chosen.option.transitDays) : null,
        };
      })()
    : null;

  const nextSteps: string[] = [];
  if (inputErrors.length) nextSteps.push(`Fix ${inputErrors.length} input problem${inputErrors.length === 1 ? "" : "s"} in the source data so every rule can be checked.`);
  if (status === "Draft") nextSteps.push(`Provide the remaining details: ${missing.slice(0, 4).map((m) => m.label).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}.`);
  if (red.length) nextSteps.push(`Resolve Red issues before submission: ${red.map((r) => r.ruleId).join(", ")}. The shipment must not leave until these are fixed.`);
  if (amber.length) nextSteps.push(`Verify or fix Amber items: ${amber.map((r) => r.ruleId).join(", ")}.`);
  if (b.destinationType === "Warehouse" && b.deliveryAppointmentBooked === false)
    nextSteps.push("Book a delivery slot with the receiving warehouse.");
  if (status !== "Draft") nextSteps.push("Double-check HS codes, quantities and values against your commercial invoice before customs.");
  if (chosen && status !== "Draft") {
    const tentative = status === "Blocked" ? " (tentative until Red issues are fixed)" : "";
    nextSteps.push(
      `Submit the booking to ${chosen.option.carrier} ${chosen.option.service}${tentative} — ${formatGBP(chosen.totalCostGBP)}. ShipmentOS has not contacted any carrier.`,
    );
  }

  let headline: string;
  const counts = `${red.length} Red, ${amber.length} Amber`;
  switch (status) {
    case "Draft":
      headline = `Draft — ${missing.length} detail${missing.length === 1 ? "" : "s"} missing${red.length + amber.length ? ` · ${counts} so far` : ""}`;
      break;
    case "Blocked":
      headline = `Blocked — ${inputErrors.length ? `${inputErrors.length} input issue${inputErrors.length === 1 ? "" : "s"}, ` : ""}${counts}`;
      break;
    case "Needs attention":
      headline = `Needs attention — ${counts}`;
      break;
    default:
      headline = "Ready to submit — all 10 checks pass";
  }
  if (timeline && chosen && status !== "Draft") {
    headline += ` · collect ${formatUK(timeline.proposedCollectionDate)}`;
  }

  return {
    engineVersion: ENGINE_VERSION,
    rateCardVersion: RATE_CARD_VERSION,
    rulebookVersion: RULEBOOK_VERSION,
    todayUK: opts.todayUK,
    status,
    redCount: red.length,
    amberCount: amber.length,
    rules,
    carrier,
    missingFields: missing,
    inputIssues,
    notes: hazardNotes(b),
    timeline,
    nextSteps,
    headline,
  };
}

export function describeTimeline(e: Evaluation): string | null {
  if (!e.timeline) return null;
  const t = e.timeline;
  return t.indicativeDeliveryDate
    ? `Proposed collection ${formatLong(t.proposedCollectionDate)}, indicative delivery ${formatLong(t.indicativeDeliveryDate)} (calendar days, not guaranteed).`
    : `Proposed collection ${formatLong(t.proposedCollectionDate)}.`;
}
