/**
 * Runtime schemas (Zod) and their inferred TypeScript types.
 *
 * TypeScript types disappear at runtime, so anything that crosses a trust boundary —
 * Gemini JSON, API request bodies, spreadsheet cells, direct edits — is parsed with these
 * schemas before it reaches the deterministic engine. Structural validation lives here;
 * the ten scoring rules live in `rules.ts` and never throw on bad business data.
 */
import { z } from "zod";
import {
  CURRENCY,
  DESTINATION_COUNTRIES,
  DESTINATION_TYPES,
  ORIGIN_CITIES,
  ORIGIN_COUNTRY,
  SELLER_PRIORITIES,
  type RuleId,
  type Severity,
  type CarrierOption,
} from "./reference";

export const LIMITS = {
  maxItemsPerBooking: 200,
  maxMessageChars: 2000,
  maxText: 200,
  maxCount: 10_000_000,
  maxMoneyGBP: 100_000_000,
  maxWeightKg: 1_000_000,
  maxPallets: 1000,
} as const;

const text = z.string().trim().max(LIMITS.maxText);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const count = z.number().int().min(0).max(LIMITS.maxCount);
const positiveCount = z.number().int().min(1).max(LIMITS.maxCount);
const money = z.number().min(0).max(LIMITS.maxMoneyGBP);
const weight = z.number().min(0).max(LIMITS.maxWeightKg);

/** `null` = not yet known (chat will ask). `""` = seller confirmed it is blank (rules will flag). */
export const DraftItemSchema = z.object({
  itemId: z.string().uuid(),
  sku: text.nullable(),
  description: text.nullable(),
  hsCode: z.string().trim().max(32).nullable(),
  quantityUnits: count.nullable(),
  unitPriceGBP: money.nullable(),
  unitsPerCarton: positiveCount.nullable(),
  cartons: count.nullable(),
  unitWeightKg: weight.nullable(),
  countryOfOrigin: text.nullable(),
  sourceRow: z.number().int().nullable().optional(),
});
export type DraftItem = z.infer<typeof DraftItemSchema>;

export const ReadyDateNoteSchema = z.enum(["year_assumed", "confirm_year"]).nullable();

export const DraftBookingSchema = z.object({
  externalBookingId: text.nullable(),
  sellerName: text.nullable(),
  originCity: z.enum(ORIGIN_CITIES).nullable(),
  originCountry: z.literal(ORIGIN_COUNTRY),
  destinationCity: text.nullable(),
  destinationCountry: z.enum(DESTINATION_COUNTRIES).nullable(),
  destinationType: z.enum(DESTINATION_TYPES).nullable(),
  readyToShipDate: isoDate.nullable(),
  readyDateNote: ReadyDateNoteSchema.optional().default(null),
  sellerPriority: z.enum(SELLER_PRIORITIES).nullable(),
  pallets: z.number().int().min(1).max(LIMITS.maxPallets).nullable(),
  cartons: count.nullable(),
  totalDeclaredValueGBP: money.nullable(),
  currency: z.literal(CURRENCY),
  totalGrossWeightKg: weight.nullable(),
  deliveryAppointmentBooked: z.boolean().nullable(),
  selectedCarrierKey: z.string().max(32).nullable(),
  items: z.array(DraftItemSchema).max(LIMITS.maxItemsPerBooking),
});
export type DraftBooking = z.infer<typeof DraftBookingSchema>;

export function emptyDraft(): DraftBooking {
  return {
    externalBookingId: null,
    sellerName: null,
    originCity: null,
    originCountry: ORIGIN_COUNTRY,
    destinationCity: null,
    destinationCountry: null,
    destinationType: null,
    readyToShipDate: null,
    readyDateNote: null,
    sellerPriority: null,
    pallets: null,
    cartons: null,
    totalDeclaredValueGBP: null,
    currency: CURRENCY,
    totalGrossWeightKg: null,
    deliveryAppointmentBooked: null,
    selectedCarrierKey: null,
    items: [],
  };
}

export function emptyItem(itemId: string): DraftItem {
  return {
    itemId,
    sku: null,
    description: null,
    hsCode: null,
    quantityUnits: null,
    unitPriceGBP: null,
    unitsPerCarton: null,
    cartons: null,
    unitWeightKg: null,
    countryOfOrigin: null,
  };
}

// ---------------------------------------------------------------------------
// Chat patch operations (produced by Gemini or by the direct edit form)
// ---------------------------------------------------------------------------

export const BOOKING_FIELDS = [
  "sellerName",
  "originCity",
  "destinationCity",
  "destinationCountry",
  "destinationType",
  "readyToShipDate",
  "sellerPriority",
  "pallets",
  "cartons",
  "totalDeclaredValueGBP",
  "totalGrossWeightKg",
  "deliveryAppointmentBooked",
  "selectedCarrierKey",
] as const;
export type BookingField = (typeof BOOKING_FIELDS)[number];

export const NUMERIC_BOOKING_FIELDS = ["pallets", "cartons", "totalDeclaredValueGBP", "totalGrossWeightKg"] as const;

export const ITEM_FIELDS = [
  "sku",
  "description",
  "hsCode",
  "quantityUnits",
  "unitPriceGBP",
  "unitsPerCarton",
  "cartons",
  "unitWeightKg",
  "countryOfOrigin",
] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

const scalar = z.union([z.string().max(LIMITS.maxText), z.number(), z.boolean(), z.null()]);

export const ItemTargetSchema = z
  .object({ itemId: z.string().max(64).nullish(), sku: z.string().max(LIMITS.maxText).nullish() })
  .refine((t) => Boolean(t.itemId || t.sku), "itemId or sku required");

const itemChanges = z
  .object({
    sku: z.string().max(LIMITS.maxText).nullish(),
    description: z.string().max(LIMITS.maxText).nullish(),
    hsCode: z.union([z.string().max(32), z.number()]).nullish(),
    quantityUnits: z.number().nullish(),
    unitPriceGBP: z.number().nullish(),
    unitsPerCarton: z.number().nullish(),
    cartons: z.number().nullish(),
    unitWeightKg: z.number().nullish(),
    countryOfOrigin: z.string().max(LIMITS.maxText).nullish(),
  })
  .strict();
export type ItemChanges = z.infer<typeof itemChanges>;

export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), field: z.enum(BOOKING_FIELDS), value: scalar }),
  z.object({ op: z.literal("increment"), field: z.enum(NUMERIC_BOOKING_FIELDS), by: z.number() }),
  z.object({ op: z.literal("remove"), field: z.enum(BOOKING_FIELDS) }),
  z.object({ op: z.literal("addItem"), item: itemChanges }),
  z.object({ op: z.literal("updateItem"), target: ItemTargetSchema, changes: itemChanges }),
  z.object({
    op: z.literal("incrementItem"),
    target: ItemTargetSchema,
    field: z.enum(["quantityUnits", "cartons", "unitsPerCarton"]),
    by: z.number(),
  }),
  z.object({ op: z.literal("removeItem"), target: ItemTargetSchema }),
]);
export type PatchOp = z.infer<typeof PatchOpSchema>;

export const ChatPatchSchema = z.object({
  operations: z.array(PatchOpSchema).max(40),
  /** Set when the message is ambiguous and nothing should change until the seller clarifies. */
  clarification: z.string().max(400).nullish(),
  /** Seller asked a question rather than giving data (e.g. "what is an HS code?"). */
  question: z.string().max(400).nullish(),
});
export type ChatPatch = z.infer<typeof ChatPatchSchema>;

// ---------------------------------------------------------------------------
// Evaluation output (all computed deterministically)
// ---------------------------------------------------------------------------

export type RuleStatus = "pass" | "fail" | "not_evaluable";

export type RuleFinding = {
  itemId?: string;
  sku?: string | null;
  message: string;
  actual?: string;
  expected?: string;
  fix: string;
};

export type RuleResult = {
  ruleId: RuleId;
  severity: Severity;
  title: string;
  description: string;
  status: RuleStatus;
  summary: string;
  findings: RuleFinding[];
  missingInputs: string[];
};

export type InputIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  sheet?: "Bookings" | "Items" | "Workbook";
  row?: number;
  column?: string;
  rawValue?: string;
};

export type CarrierCandidate = {
  option: CarrierOption;
  totalCostGBP: number;
  eligible: boolean;
  exclusionReason: string | null;
  score: number | null;
  rank: number | null;
};

export type CarrierAssessment = {
  status: "recommended" | "no_eligible" | "not_evaluable";
  priority: (typeof SELLER_PRIORITIES)[number] | null;
  pallets: number | null;
  grossWeightKg: number | null;
  kgPerPallet: number | null;
  candidates: CarrierCandidate[];
  recommendedKey: string | null;
  selectedKey: string | null;
  /** The carrier R-05 is checked against: explicit selection, else recommendation. */
  chosenKey: string | null;
  explanation: string;
  requiredPallets: number | null;
  missingInputs: string[];
};

export type ShipmentStatus = "Draft" | "Blocked" | "Needs attention" | "Ready to submit";

export type MissingField = {
  key: string;
  label: string;
  itemId?: string;
  field: string;
};

export type Evaluation = {
  engineVersion: string;
  rateCardVersion: string;
  rulebookVersion: string;
  todayUK: string;
  status: ShipmentStatus;
  redCount: number;
  amberCount: number;
  rules: RuleResult[];
  carrier: CarrierAssessment;
  missingFields: MissingField[];
  inputIssues: InputIssue[];
  notes: string[];
  timeline: { proposedCollectionDate: string; indicativeDeliveryDate: string | null } | null;
  nextSteps: string[];
  headline: string;
};
