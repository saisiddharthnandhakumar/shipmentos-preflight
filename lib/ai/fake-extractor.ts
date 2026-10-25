/**
 * Deterministic stand-in for Gemini used ONLY by local E2E tests (SHIPMENTOS_FAKE_AI=1, never on
 * Vercel). It understands the demo phrasings so browser tests don't depend on a paid model.
 */
import { DESTINATION_CITIES, DESTINATION_COUNTRIES, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES } from "../domain/reference";
import type { ChatPatch, PatchOp } from "../domain/schemas";
import type { Extractor } from "./extract";

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const num = (s: string) => WORDS[s.toLowerCase()] ?? Number(s.replace(/,/g, ""));

export const fakeExtractor: Extractor = async ({ message, draft, focusFields }) => {
  if (focusFields?.length) return { operations: [] };
  const m = message;
  const lower = m.toLowerCase();
  const ops: PatchOp[] = [];
  if (/\b(fail|explode)\b/.test(lower) && /\bai\b/.test(lower)) throw new Error("fake failure");

  const inc = /\b(?:add|plus)\s+(a|an|one|two|three|\d+)\s+(?:more\s+)?pallets?\b|\b(one|two|\d+)\s+more\s+pallets?\b/i.exec(m);
  if (inc) ops.push({ op: "increment", field: "pallets", by: num(inc[1] ?? inc[2]) });
  else {
    const p = /\b(\d+|one|two|three|four|five)\s+pallets?\b/i.exec(m);
    if (p) ops.push({ op: "set", field: "pallets", value: num(p[1]) });
  }
  for (const c of ORIGIN_CITIES) if (new RegExp(`\\bfrom\\s+${c}\\b`, "i").test(m)) ops.push({ op: "set", field: "originCity", value: c });
  const destCities = DESTINATION_COUNTRIES.flatMap((k) => DESTINATION_CITIES[k]);
  for (const c of destCities) if (new RegExp(`\\b${c}\\b`, "i").test(m) && !new RegExp(`from\\s+${c}`, "i").test(m)) ops.push({ op: "set", field: "destinationCity", value: c });
  for (const c of DESTINATION_COUNTRIES) if (new RegExp(`\\b(make it|to|instead)\\b[^.]*\\b${c}\\b|\\b${c}\\s+instead`, "i").test(m)) ops.unshift({ op: "set", field: "destinationCountry", value: c });
  if (/\bwarehouse\b/i.test(m)) ops.push({ op: "set", field: "destinationType", value: "Warehouse" });
  else if (/\b(shop|store|office|business address)\b/i.test(m)) ops.push({ op: "set", field: "destinationType", value: "Business address" });
  const ready = /\bready\s+(?:on\s+|by\s+)?([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}(?:\s+\d{4})?|\d{1,2}-\d{1,2}-\d{4}|tomorrow)/i.exec(m);
  if (ready) ops.push({ op: "set", field: "readyToShipDate", value: ready[1] });
  for (const [re, v] of [[/cheapest|cheap/i, "Cheapest"], [/fastest|as fast as/i, "Fastest"], [/most reliable|reliable/i, "Most reliable"], [/balanced|no preference/i, "Balanced"]] as const)
    if (re.test(m)) {
      ops.push({ op: "set", field: "sellerPriority", value: v });
      break;
    }
  const seller = /\b(?:seller is|business is|we are|company is|sending as)\s+([A-Za-z][\w&' ]+?)(?:[.,;]|$)/i.exec(m);
  if (seller) ops.push({ op: "set", field: "sellerName", value: seller[1].trim() });
  const gross = /\b(?:gross(?:\s+weight)?(?:\s+is)?\s+(\d[\d,.]*)\s*kg|(\d[\d,.]*)\s*kg\s+(?:gross|total|in total))/i.exec(m);
  if (gross) ops.push({ op: "set", field: "totalGrossWeightKg", value: num(gross[1] ?? gross[2]) });
  const declared = /\bdeclared(?:\s+value)?(?:\s+is)?\s+£?(\d[\d,.]*)/i.exec(m);
  if (declared) ops.push({ op: "set", field: "totalDeclaredValueGBP", value: num(declared[1]) });
  const totalCartons = /\b(\d+)\s+cartons\s+in\s+total|\btotal(?:\s+of)?\s+(\d+)\s+cartons/i.exec(m);
  if (totalCartons) ops.push({ op: "set", field: "cartons", value: num(totalCartons[1] ?? totalCartons[2]) });
  if (/\b(booked the (delivery )?appointment|appointment (is )?booked|have booked the slot)\b/i.test(m)) ops.push({ op: "set", field: "deliveryAppointmentBooked", value: true });
  else if (/\bno appointment|appointment (is )?not booked|not booked( yet)?\b/i.test(m)) ops.push({ op: "set", field: "deliveryAppointmentBooked", value: false });

  // Item facts
  const changes: Record<string, unknown> = {};
  const sku = /\bSKU\s+([A-Z0-9-]+)/i.exec(m);
  if (sku) changes.sku = sku[1];
  const desc = /\bpallets?\s+of\s+([a-z ]+?)(?:\s+from\b|[.,]|$)/i.exec(m);
  if (desc && !draft.items.length) changes.description = desc[1].trim().replace(/^\w/, (c) => c.toUpperCase());
  const upc = /\b(\d+)\s+(?:units?\s+)?(?:each|per carton|a carton)\b/i.exec(m);
  if (upc) changes.unitsPerCarton = num(upc[1]);
  const cartons = /\b(?:the\s+)?cartons\s+are\s+(\d+)|\b(\d+)\s+cartons\b(?!\s+in total)/i.exec(m);
  if (cartons) changes.cartons = num(cartons[1] ?? cartons[2]);
  const qty = /\b(\d[\d,]*)\s+(?:mugs|units|pieces|shirts|items)\b(?!\s+each)/i.exec(m);
  if (qty) changes.quantityUnits = num(qty[1]);
  const price = /£\s?(\d+(?:\.\d+)?)\s+(?:each|per unit|a unit)/i.exec(m);
  if (price) changes.unitPriceGBP = num(price[1]);
  const weight = /\b(\d+(?:\.\d+)?)\s*kg\s+(?:each|per unit|a unit)/i.exec(m);
  if (weight) changes.unitWeightKg = num(weight[1]);
  const hs = /\bHS(?:\s+code)?\s+(\d{2,10})/i.exec(m);
  if (hs) changes.hsCode = hs[1];
  if (/\bno hs code\b/i.test(m)) changes.hsCode = "";
  for (const c of ITEM_ORIGIN_COUNTRIES) if (new RegExp(`\\bmade in (the )?${c}\\b`, "i").test(m)) changes.countryOfOrigin = c;
  if (Object.keys(changes).length) {
    if (draft.items.length) ops.push({ op: "updateItem", target: { itemId: draft.items[0].itemId }, changes });
    else ops.push({ op: "addItem", item: changes });
  }
  const patch: ChatPatch = { operations: ops };
  if (!ops.length) patch.clarification = "Could you tell me a bit more about the shipment?";
  return patch;
};
