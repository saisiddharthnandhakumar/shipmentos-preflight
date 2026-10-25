/**
 * Fixed reference data extracted from `Case2_Shipment_Booking_Test_Data_Format.xlsx`
 * (sheets "Carrier options", "Rulebook" and "Allowed values"). The workbook marks these
 * sheets "FIXED - judges will use exactly this rate card / these are the only rules".
 *
 * This fixture is the checked-in source of truth for tests and for the Neon seed.
 * At runtime the app reads the seeded Neon rows and refuses to evaluate if they diverge.
 */

export const RATE_CARD_VERSION = "case2-2026-template-v1";
export const RULEBOOK_VERSION = "case2-2026-template-v1";
export const ENGINE_VERSION = "engine-1.0.0";

export const ORIGIN_COUNTRY = "United Kingdom" as const;
export const CURRENCY = "GBP" as const;

export const ORIGIN_CITIES = ["London", "Manchester", "Birmingham", "Leeds"] as const;
export const DESTINATION_COUNTRIES = ["Germany", "France", "Netherlands"] as const;
export const DESTINATION_CITIES: Record<DestinationCountry, readonly string[]> = {
  Germany: ["Berlin", "Frankfurt", "Hamburg"],
  France: ["Paris", "Lyon"],
  Netherlands: ["Amsterdam", "Rotterdam"],
};
export const DESTINATION_TYPES = ["Warehouse", "Business address"] as const;
export const SELLER_PRIORITIES = ["Cheapest", "Fastest", "Most reliable", "Balanced"] as const;
export const ITEM_ORIGIN_COUNTRIES = [
  "United Kingdom",
  "China",
  "India",
  "Vietnam",
  "Turkey",
  "Germany",
] as const;

export type OriginCity = (typeof ORIGIN_CITIES)[number];
export type DestinationCountry = (typeof DESTINATION_COUNTRIES)[number];
export type DestinationType = (typeof DESTINATION_TYPES)[number];
export type SellerPriority = (typeof SELLER_PRIORITIES)[number];

export type CarrierOption = {
  key: string;
  carrier: string;
  service: string;
  originCountry: typeof ORIGIN_COUNTRY;
  destinationCountry: DestinationCountry;
  pricePerPalletGBP: number;
  currency: typeof CURRENCY;
  transitDays: number;
  onTimeRatePercent: number;
  maxWeightPerPalletKg: number;
};

const COUNTRY_CODE: Record<DestinationCountry, string> = {
  Germany: "DE",
  France: "FR",
  Netherlands: "NL",
};

function option(
  carrier: "A" | "B" | "C",
  destinationCountry: DestinationCountry,
  pricePerPalletGBP: number,
): CarrierOption {
  const services = {
    A: { service: "Road economy", transitDays: 5, onTimeRatePercent: 92, maxWeightPerPalletKg: 500 },
    B: { service: "Road standard", transitDays: 3, onTimeRatePercent: 95, maxWeightPerPalletKg: 750 },
    C: { service: "Road express", transitDays: 2, onTimeRatePercent: 98, maxWeightPerPalletKg: 400 },
  } as const;
  return {
    key: `GB-${COUNTRY_CODE[destinationCountry]}-${carrier}`,
    carrier: `Carrier ${carrier}`,
    originCountry: ORIGIN_COUNTRY,
    destinationCountry,
    pricePerPalletGBP,
    currency: CURRENCY,
    ...services[carrier],
  };
}

/** Workbook "Carrier options" rows 3–11, in sheet order. */
export const CARRIER_OPTIONS: readonly CarrierOption[] = [
  option("A", "Germany", 180),
  option("B", "Germany", 220),
  option("C", "Germany", 340),
  option("A", "France", 170),
  option("B", "France", 210),
  option("C", "France", 330),
  option("A", "Netherlands", 160),
  option("B", "Netherlands", 200),
  option("C", "Netherlands", 320),
];

export type RuleId = "R-01" | "R-02" | "R-03" | "R-04" | "R-05" | "R-06" | "R-07" | "R-08" | "R-09" | "R-10";
export type Severity = "Red" | "Amber";

export type RuleDefinition = { ruleId: RuleId; description: string; severity: Severity; title: string };

/** Workbook "Rulebook" rows 3–12. `description` is verbatim; `title` is our short UI label. */
export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  { ruleId: "R-01", severity: "Red", title: "HS code", description: "Every item must have an HS code of at least 6 digits" },
  { ruleId: "R-02", severity: "Red", title: "Declared value", description: "Total declared value must equal the sum of quantity × unit price across all items (within 1%)" },
  { ruleId: "R-03", severity: "Red", title: "Carton quantity", description: "For each item, units per carton × cartons must equal quantity" },
  { ruleId: "R-04", severity: "Red", title: "Total cartons", description: "Total cartons on the booking must equal the sum of cartons across all items" },
  { ruleId: "R-05", severity: "Red", title: "Weight per pallet", description: "Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet" },
  { ruleId: "R-06", severity: "Red", title: "Prohibited goods", description: "No lithium batteries, aerosols or flammable liquids" },
  { ruleId: "R-07", severity: "Amber", title: "Gross weight", description: "Total gross weight must be at least the sum of unit weight × quantity across all items" },
  { ruleId: "R-08", severity: "Amber", title: "Delivery appointment", description: "Shipments to a warehouse must have a delivery appointment booked" },
  { ruleId: "R-09", severity: "Amber", title: "Country of origin", description: "Every item must have a country of origin" },
  { ruleId: "R-10", severity: "Amber", title: "Ready date", description: "Ready to ship date must not be in the past" },
];

export const RULE_BY_ID: Record<RuleId, RuleDefinition> = Object.fromEntries(
  RULE_DEFINITIONS.map((r) => [r.ruleId, r]),
) as Record<RuleId, RuleDefinition>;

export function isDestinationCountry(v: string): v is DestinationCountry {
  return (DESTINATION_COUNTRIES as readonly string[]).includes(v);
}

export function countryForDestinationCity(city: string): DestinationCountry | null {
  for (const country of DESTINATION_COUNTRIES) {
    if (DESTINATION_CITIES[country].includes(city)) return country;
  }
  return null;
}

/** The template's grey example rows (Bookings row 3 / Items row 3), used only to recognise and skip them. */
export const TEMPLATE_EXAMPLE_BOOKING = [
  "BK-001", "Northfield Goods", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Warehouse",
  "05-11-2026", "Cheapest", "3", "90", "5400", "GBP", "620", "Yes",
] as const;
export const TEMPLATE_EXAMPLE_ITEM = [
  "BK-001", "MUG-01", "Ceramic coffee mug, 350 ml", "691200", "1080", "5", "12", "90", "0.5", "United Kingdom",
] as const;
