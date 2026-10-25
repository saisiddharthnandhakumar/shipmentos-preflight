import { emptyDraft, type DraftBooking, type DraftItem } from "@/lib/domain/schemas";

export function uuid(): string {
  return crypto.randomUUID();
}

export function item(over: Partial<DraftItem> = {}): DraftItem {
  return {
    itemId: uuid(),
    sku: "MUG-01",
    description: "Ceramic coffee mug, 350 ml",
    hsCode: "691200",
    quantityUnits: 1080,
    unitPriceGBP: 5,
    unitsPerCarton: 12,
    cartons: 90,
    unitWeightKg: 0.5,
    countryOfOrigin: "United Kingdom",
    ...over,
  };
}

/** The template's BK-001 example, fully specified. */
export function bk001(over: Partial<DraftBooking> = {}, items?: DraftItem[]): DraftBooking {
  return {
    ...emptyDraft(),
    externalBookingId: "BK-001",
    sellerName: "Northfield Goods",
    originCity: "Manchester",
    destinationCity: "Frankfurt",
    destinationCountry: "Germany",
    destinationType: "Warehouse",
    readyToShipDate: "2026-11-05",
    sellerPriority: "Cheapest",
    pallets: 3,
    cartons: 90,
    totalDeclaredValueGBP: 5400,
    totalGrossWeightKg: 620,
    deliveryAppointmentBooked: true,
    items: items ?? [item()],
    ...over,
  };
}

export const TODAY = "2026-10-25";
