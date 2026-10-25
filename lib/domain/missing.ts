/**
 * Deterministic "what is still unknown" computation for chat drafts. Gemini never decides this.
 * A field that is known (including an explicit blank HS code / country of origin) is never asked again.
 */
import type { BookingField, DraftBooking, ItemField, MissingField } from "./schemas";

export const BOOKING_FIELD_LABELS: Record<BookingField, string> = {
  sellerName: "seller name",
  originCity: "collection city",
  destinationCity: "destination city",
  destinationCountry: "destination country",
  destinationType: "destination type (warehouse or business address)",
  readyToShipDate: "ready-to-ship date",
  sellerPriority: "priority (cheapest, fastest, most reliable or balanced)",
  pallets: "number of pallets",
  cartons: "total cartons",
  totalDeclaredValueGBP: "total declared value (GBP)",
  totalGrossWeightKg: "total gross weight (kg)",
  deliveryAppointmentBooked: "whether a warehouse delivery appointment is booked",
  selectedCarrierKey: "carrier",
};

export const ITEM_FIELD_LABELS: Record<ItemField, string> = {
  sku: "SKU",
  description: "description",
  hsCode: "HS code",
  quantityUnits: "quantity (units)",
  unitPriceGBP: "unit price (GBP)",
  unitsPerCarton: "units per carton",
  cartons: "cartons",
  unitWeightKg: "unit weight (kg)",
  countryOfOrigin: "country of origin",
};

/** Booking-level order mirrors how a seller usually describes a shipment. */
const BOOKING_ORDER: BookingField[] = [
  "originCity",
  "destinationCity",
  "destinationType",
  "sellerName",
  "readyToShipDate",
  "sellerPriority",
  "pallets",
  "totalGrossWeightKg",
  "cartons",
  "totalDeclaredValueGBP",
  "deliveryAppointmentBooked",
];

const ITEM_ORDER: ItemField[] = [
  "sku",
  "description",
  "quantityUnits",
  "unitsPerCarton",
  "cartons",
  "unitPriceGBP",
  "unitWeightKg",
  "hsCode",
  "countryOfOrigin",
];

export function missingFields(b: DraftBooking): MissingField[] {
  const out: MissingField[] = [];
  for (const f of BOOKING_ORDER) {
    if (f === "destinationCity") {
      if (!b.destinationCity) {
        out.push({
          key: "destinationCity",
          field: "destinationCity",
          label: b.destinationCountry ? `destination city in ${b.destinationCountry}` : "destination city and country",
        });
      }
      continue;
    }
    if (f === "deliveryAppointmentBooked") {
      // Only warehouses need an appointment (R-08); business addresses are exempt.
      if (b.destinationType === "Warehouse" && b.deliveryAppointmentBooked == null)
        out.push({ key: f, field: f, label: BOOKING_FIELD_LABELS[f] });
      continue;
    }
    if (b[f] == null) out.push({ key: f, field: f, label: BOOKING_FIELD_LABELS[f] });
  }
  if (!b.items.length) {
    out.push({ key: "items", field: "items", label: "at least one product line" });
  }
  b.items.forEach((item, i) => {
    const name = item.sku ?? item.description ?? `item ${i + 1}`;
    for (const f of ITEM_ORDER) {
      if (item[f] == null) out.push({ key: `item:${item.itemId}:${f}`, itemId: item.itemId, field: f, label: `${ITEM_FIELD_LABELS[f]} for ${name}` });
    }
  });
  return out;
}
