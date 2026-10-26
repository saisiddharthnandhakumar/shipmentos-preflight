/**
 * Tap-to-answer options for the question being asked. Each option is a ready-made patch, so a tap is
 * applied by the same fixed rules as a typed answer and never needs the AI.
 */
import { addDays, formatUK, todayUK } from "./dates";
import { DESTINATION_CITIES, DESTINATION_COUNTRIES, DESTINATION_TYPES, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, SELLER_PRIORITIES } from "./reference";
import { nextQuestionFields } from "./reply";
import type { DraftBooking, MissingField, PatchOp } from "./schemas";

export type ChoiceOption = { label: string; hint?: string; /** What the seller "said", shown as their chat bubble. */ say: string; ops: PatchOp[] };
export type ChoiceGroup = { key: string; prompt: string; options: ChoiceOption[] };

const set = (field: Extract<PatchOp, { op: "set" }>["field"], value: string | number | boolean): PatchOp[] => [{ op: "set", field, value }];

function dateOptions(today: string): ChoiceOption[] {
  return ([["Tomorrow", 1], ["In 3 days", 3], ["In a week", 7], ["In 2 weeks", 14]] as const).map(([label, days]) => {
    const iso = addDays(today, days);
    return { label, hint: formatUK(iso), say: `Ready on ${formatUK(iso)}`, ops: set("readyToShipDate", iso) };
  });
}

/** Option groups for the fields we are asking about right now (at most three, same as the question). */
export function choicesFor(draft: DraftBooking, missing: MissingField[], today: string = todayUK()): ChoiceGroup[] {
  const out: ChoiceGroup[] = [];
  for (const m of nextQuestionFields(missing)) {
    if (!m.itemId) {
      switch (m.key) {
        case "originCity":
          out.push({ key: m.key, prompt: "Collecting from", options: ORIGIN_CITIES.map((c) => ({ label: c, say: `Collecting from ${c}`, ops: set("originCity", c) })) });
          break;
        case "destinationCity": {
          const countries = draft.destinationCountry ? [draft.destinationCountry] : DESTINATION_COUNTRIES;
          out.push({ key: m.key, prompt: "Delivering to", options: countries.flatMap((k) => DESTINATION_CITIES[k].map((c) => ({ label: c, hint: k, say: `Delivering to ${c}`, ops: set("destinationCity", c) }))) });
          break;
        }
        case "destinationType":
          out.push({ key: m.key, prompt: "Delivery location", options: DESTINATION_TYPES.map((t) => ({ label: t, say: t === "Warehouse" ? "It's going to a warehouse" : "It's going to a business address", ops: set("destinationType", t) })) });
          break;
        case "sellerPriority":
          out.push({ key: m.key, prompt: "What matters most", options: SELLER_PRIORITIES.map((p) => ({ label: p, say: `${p} please`, ops: set("sellerPriority", p) })) });
          break;
        case "readyToShipDate":
          out.push({ key: m.key, prompt: "Ready to ship", options: dateOptions(today) });
          break;
        case "deliveryAppointmentBooked":
          out.push({
            key: m.key,
            prompt: "Delivery appointment",
            options: [
              { label: "Booked", say: "The delivery appointment is booked", ops: set("deliveryAppointmentBooked", true) },
              { label: "Not booked yet", say: "The delivery appointment isn't booked yet", ops: set("deliveryAppointmentBooked", false) },
            ],
          });
          break;
      }
      continue;
    }
    const item = draft.items.find((i) => i.itemId === m.itemId);
    const name = item?.sku ?? item?.description ?? "this item";
    const target = { itemId: m.itemId! };
    if (m.field === "countryOfOrigin")
      out.push({
        key: m.key,
        prompt: `Made in (${name})`,
        options: [
          ...ITEM_ORIGIN_COUNTRIES.map((c) => ({ label: c, say: `${name} is made in ${c}`, ops: [{ op: "updateItem", target, changes: { countryOfOrigin: c } }] as PatchOp[] })),
          { label: "Not sure", say: `I don't know where ${name} is made`, ops: [{ op: "updateItem", target, changes: { countryOfOrigin: "" } }] as PatchOp[] },
        ],
      });
    if (m.field === "hsCode") out.push({ key: m.key, prompt: `HS code (${name})`, options: [{ label: "I don't have one yet", say: `I don't have an HS code for ${name} yet`, ops: [{ op: "updateItem", target, changes: { hsCode: "" } }] }] });
  }
  return out;
}
