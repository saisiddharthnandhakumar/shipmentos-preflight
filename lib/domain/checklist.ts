/**
 * The booking checklist: every detail the checks need, in the order we ask for them, ticked off as it
 * arrives. Built from the draft and the deterministic missing-field list; nothing here is model output.
 */
import { ITEM_FIELD_LABELS } from "./missing";
import { nextQuestionFields } from "./reply";
import type { DraftBooking, ItemField, MissingField } from "./schemas";

export type ChecklistRow = { key: string; label: string; done: boolean; /** Being asked for right now. */ next: boolean };
export type ChecklistGroup = { id: string; title: string | null; rows: ChecklistRow[] };
export type Checklist = { groups: ChecklistGroup[]; done: number; total: number; complete: boolean };

/** Asking order: the route, who/when/priority, the products, then totals and the delivery appointment. */
const ROUTE = [
  ["originCity", "Collection city"],
  ["destinationCity", "Destination city"],
  ["destinationType", "Destination type"],
] as const;
const WHO_WHEN = [
  ["sellerName", "Seller name"],
  ["readyToShipDate", "Ready-to-ship date"],
  ["sellerPriority", "Priority"],
] as const;
const TOTALS = [
  ["pallets", "Number of pallets"],
  ["totalGrossWeightKg", "Total gross weight"],
  ["cartons", "Total cartons"],
  ["totalDeclaredValueGBP", "Total declared value"],
] as const;
const ITEM_ORDER: ItemField[] = ["sku", "description", "quantityUnits", "unitsPerCarton", "cartons", "unitPriceGBP", "unitWeightKg", "hsCode", "countryOfOrigin"];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildChecklist(draft: DraftBooking, missing: MissingField[]): Checklist {
  const missingKeys = new Set(missing.map((m) => m.key));
  const asking = new Set(nextQuestionFields(missing).map((m) => m.key));
  const row = (key: string, label: string): ChecklistRow => ({ key, label, done: !missingKeys.has(key), next: asking.has(key) });
  const groups: ChecklistGroup[] = [
    { id: "route", title: null, rows: ROUTE.map(([k, l]) => row(k, l)) },
    { id: "who", title: null, rows: WHO_WHEN.map(([k, l]) => row(k, l)) },
  ];
  const itemRows: ChecklistRow[] = [];
  if (!draft.items.length) itemRows.push(row("items", "At least one product"));
  groups.push({ id: "items-head", title: null, rows: itemRows });
  draft.items.forEach((item, i) => {
    const name = item.sku ?? item.description ?? `Item ${i + 1}`;
    groups.push({ id: `item-${item.itemId}`, title: name, rows: ITEM_ORDER.map((f) => row(`item:${item.itemId}:${f}`, cap(ITEM_FIELD_LABELS[f]))) });
  });
  groups.push({ id: "totals", title: null, rows: TOTALS.map(([k, l]) => row(k, l)) });
  // Only warehouses need a delivery appointment.
  if (draft.destinationType === "Warehouse") groups[groups.length - 1].rows.push(row("deliveryAppointmentBooked", "Delivery appointment"));
  const rows = groups.flatMap((g) => g.rows);
  const done = rows.filter((r) => r.done).length;
  return { groups: groups.filter((g) => g.rows.length), done, total: rows.length, complete: done === rows.length };
}
