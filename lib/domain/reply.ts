/**
 * Deterministic assistant replies built from computed state. The AI never writes these numbers.
 */
import { carrierLabel } from "./carriers";
import { formatLong, formatUK } from "./dates";
import { formatGBP, formatKg } from "./decimal";
import { describeTimeline } from "./evaluate";
import { ITEM_FIELD_LABELS } from "./missing";
import { DESTINATION_CITIES } from "./reference";
import type { Change } from "./patch";
import type { DraftBooking, Evaluation, MissingField } from "./schemas";

const QUESTION: Record<string, (b: DraftBooking) => string> = {
  originCity: () => "Which city are you collecting from (London, Manchester, Birmingham or Leeds)?",
  destinationCity: (b) =>
    b.destinationCountry
      ? `Which city in ${b.destinationCountry} is it going to (${DESTINATION_CITIES[b.destinationCountry].join(", ")})?`
      : "Where is it going — Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam?",
  destinationType: () => "Is it being delivered to a warehouse or a business address?",
  sellerName: () => "What business is sending this?",
  readyToShipDate: () => "When will the goods be packed and ready for collection?",
  sellerPriority: () => "What matters most: cheapest, fastest, most reliable, or a balance?",
  pallets: () => "How many pallets?",
  totalGrossWeightKg: () => "What's the total gross weight in kg (including cartons and pallets)?",
  cartons: () => "How many cartons in total?",
  totalDeclaredValueGBP: () => "What's the total declared value on your paperwork, in GBP?",
  deliveryAppointmentBooked: () => "Have you booked a delivery appointment with the receiving warehouse?",
  items: () => "What are you shipping? For each product, tell me the SKU, a short description, how many units, units per carton and number of cartons.",
};

/** Groups asked together (1–3 related fields per question). */
const GROUPS: string[][] = [
  ["originCity", "destinationCity", "destinationType"],
  ["sellerName", "readyToShipDate", "sellerPriority"],
  ["items"],
  ["item:sku", "item:description", "item:quantityUnits"],
  ["item:unitsPerCarton", "item:cartons"],
  ["item:unitPriceGBP", "item:unitWeightKg"],
  ["item:hsCode", "item:countryOfOrigin"],
  ["pallets", "totalGrossWeightKg"],
  ["cartons", "totalDeclaredValueGBP"],
  ["deliveryAppointmentBooked"],
];

function groupKey(m: MissingField): string {
  return m.itemId ? `item:${m.field}` : m.key;
}

/** The next 1–3 related missing fields to ask about (same item for item fields). */
export function nextQuestionFields(missing: MissingField[]): MissingField[] {
  const out: MissingField[] = [];
  for (const g of GROUPS) {
    let hits = missing.filter((m) => g.includes(groupKey(m)));
    if (!hits.length) continue;
    if (hits[0].itemId) hits = hits.filter((h) => h.itemId === hits[0].itemId);
    // Combine a lone field with the next group so each reply asks 2–3 related things.
    const room = 3 - out.length;
    if (out.length && (out[0].itemId ? 1 : 0) !== (hits[0].itemId ? 1 : 0) && out.length >= 2) break;
    out.push(...hits.slice(0, room));
    if (out.length >= 2) break;
  }
  return out.length ? out : missing.slice(0, 3);
}

export function questionFor(fields: MissingField[], b: DraftBooking): string {
  if (!fields.length) return "";
  const booking = fields.filter((f) => !f.itemId);
  const item = fields.filter((f) => f.itemId);
  if (booking.length && item.length) return `${questionFor(booking, b)} ${questionFor(item, b)}`;
  if (fields[0].itemId) {
    const item = b.items.find((i) => i.itemId === fields[0].itemId);
    const name = item?.sku ?? item?.description ?? "this item";
    const labels = fields.map((f) => ITEM_FIELD_LABELS[f.field as keyof typeof ITEM_FIELD_LABELS] ?? f.label);
    const hint = fields.some((f) => f.field === "hsCode")
      ? " (If you don't have an HS code yet, say so — I'll flag it rather than guess one.)"
      : "";
    return `For ${name}, what's the ${joinAnd(labels)}?${hint}`;
  }
  return fields.map((f) => QUESTION[f.key]?.(b) ?? `What's the ${f.label}?`).join(" ");
}

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export type ReplyInput = {
  draft: DraftBooking;
  evaluation: Evaluation;
  previous: Evaluation | null;
  changes: Change[];
  warnings: string[];
  clarification?: string | null;
  question?: string | null;
  operationCount?: number;
  /** Reply to an Edit booking save: thank the user instead of echoing the changes (the event line already lists them). */
  fromEdit?: boolean;
};

export function composeReply(r: ReplyInput): string {
  const { draft: b, evaluation: e, previous, changes, warnings } = r;
  const parts: string[] = [];

  if (r.question) parts.push(r.question);

  const visible = changes.filter((c) => !c.quiet);
  if (r.fromEdit) {
    if (visible.length) parts.push("Thanks for those details.");
  } else if (visible.length) {
    const shown = visible.slice(0, 10).map((c) => (c.before === "—" ? `${c.label}: ${c.after}` : `${c.label} ${c.before} → ${c.after}`));
    parts.push(`Got it — ${shown.join("; ")}${visible.length > 10 ? ` (+${visible.length - 10} more)` : ""}.`);
  } else if (!r.question && !r.clarification && !warnings.length) {
    parts.push(r.operationCount ? "That's already in the booking — nothing changed." : "I didn't find any shipment details to change in that message.");
  }
  if (b.readyDateNote === "year_assumed" && changes.some((c) => c.field === "readyToShipDate") && b.readyToShipDate)
    parts.push(`I've taken the ready date as ${formatLong(b.readyToShipDate)} (${formatUK(b.readyToShipDate)}) — tell me if you meant a different year.`);
  if (b.readyDateNote === "confirm_year" && changes.some((c) => c.field === "readyToShipDate") && b.readyToShipDate)
    parts.push(`${formatUK(b.readyToShipDate)} has already passed this year — did you mean next year? I'll flag R-10 until it's confirmed.`);
  for (const w of warnings) parts.push(w);
  if (r.clarification) parts.push(r.clarification);

  // Carrier/cost impact, quoted from the deterministic assessment.
  const rec = e.carrier.candidates.find((c) => c.option.key === e.carrier.chosenKey);
  const prevRec = previous?.carrier.candidates.find((c) => c.option.key === previous.carrier.chosenKey);
  const carrierChanged = rec && (!prevRec || prevRec.option.key !== rec.option.key || prevRec.totalCostGBP !== rec.totalCostGBP || previous?.carrier.kgPerPallet !== e.carrier.kgPerPallet);
  if (rec && carrierChanged) {
    const before = prevRec ? ` (was ${carrierLabel(prevRec.option)} ${formatGBP(prevRec.totalCostGBP)})` : "";
    parts.push(
      `${e.carrier.status === "recommended" ? "Recommended" : "Chosen"}: ${carrierLabel(rec.option)} — ${b.pallets} × ${formatGBP(rec.option.pricePerPalletGBP)} = ${formatGBP(rec.totalCostGBP)}, ${rec.option.transitDays} days, ${rec.option.onTimeRatePercent}% on time; ${formatKg(e.carrier.kgPerPallet!)} per pallet${before}.`,
    );
  } else if (e.carrier.status === "no_eligible" && previous?.carrier.status !== "no_eligible") {
    parts.push(e.carrier.explanation);
  }

  // Newly failing / newly fixed rules.
  const prevFail = new Set(previous?.rules.filter((x) => x.status === "fail").map((x) => x.ruleId) ?? []);
  const nowFail = e.rules.filter((x) => x.status === "fail");
  const newlyFailed = nowFail.filter((x) => !prevFail.has(x.ruleId));
  const fixed = [...prevFail].filter((id) => !nowFail.some((x) => x.ruleId === id));
  for (const f of newlyFailed.slice(0, 3)) parts.push(`Flagged ${f.ruleId} (${f.severity}): ${f.summary} Fix: ${f.findings[0]?.fix ?? ""}`.trim());
  if (fixed.length) parts.push(`Now passing: ${fixed.join(", ")}.`);

  if (e.status === "Draft") {
    const ask = questionFor(nextQuestionFields(e.missingFields), b);
    if (ask) parts.push(ask);
  } else {
    parts.push(statusLine(e));
  }
  return parts.join("\n\n");
}

export function statusLine(e: Evaluation): string {
  const tl = describeTimeline(e);
  switch (e.status) {
    case "Ready to submit":
      return `All details are in and all 10 checks pass — this booking is ready to submit. ${tl ?? ""} This is a prepared draft: no carrier has been contacted or booked.`.trim();
    case "Needs attention":
      return `All details are in. Status: Needs attention (${e.amberCount} Amber). It can be submitted, but please check the flagged items first. ${tl ?? ""}`.trim();
    case "Blocked":
      return `All details are in. Status: Blocked (${e.redCount} Red${e.amberCount ? `, ${e.amberCount} Amber` : ""}) — this shipment must not leave until the Red issues are fixed. Any carrier shown is tentative.`;
    default:
      return e.headline;
  }
}

export function welcomeMessage(): string {
  return "Hi! Tell me about your shipment in your own words — where it's going, what's in it, how many pallets, when it's ready. I'll fill in the booking, ask only for what's missing, and check it against the 10 pre-flight rules.";
}
