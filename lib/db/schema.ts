import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** Exact decimals (GBP, kg). node-postgres returns these as strings; never floats in SQL. */
const decimal = (name: string) => numeric(name, { precision: 14, scale: 4 });

export const anonymousSessions = pgTable("anonymous_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [index("anonymous_sessions_expires_idx").on(t.expiresAt)]);

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => anonymousSessions.id, { onDelete: "cascade" }),
  originalFilenameSanitized: text("original_filename_sanitized").notNull(),
  bookingRowCount: integer("booking_row_count").notNull(),
  itemRowCount: integer("item_row_count").notNull(),
  status: text("status").notNull(),
  summary: jsonb("summary").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("import_batches_session_idx").on(t.sessionId, t.createdAt)]);

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => anonymousSessions.id, { onDelete: "cascade" }),
  importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["chat", "excel"] }).notNull(),
  createRequestId: text("create_request_id"),
  externalBookingId: text("external_booking_id"),
  title: text("title").notNull(),
  sellerName: text("seller_name"),
  originCity: text("origin_city"),
  originCountry: text("origin_country").notNull().default("United Kingdom"),
  destinationCity: text("destination_city"),
  destinationCountry: text("destination_country"),
  destinationType: text("destination_type"),
  readyToShipDate: date("ready_to_ship_date", { mode: "string" }),
  readyDateNote: text("ready_date_note"),
  sellerPriority: text("seller_priority"),
  pallets: integer("pallets"),
  cartons: integer("cartons"),
  totalDeclaredValueGbp: decimal("total_declared_value_gbp"),
  currency: text("currency").notNull().default("GBP"),
  totalGrossWeightKg: decimal("total_gross_weight_kg"),
  deliveryAppointmentBooked: boolean("delivery_appointment_booked"),
  selectedCarrierKey: text("selected_carrier_key"),
  revision: integer("revision").notNull().default(0),
  status: text("status").notNull(),
  redCount: integer("red_count").notNull().default(0),
  amberCount: integer("amber_count").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),
  sourceRow: integer("source_row"),
  rawRow: jsonb("raw_row"),
  confirmedAt: ts("confirmed_at"),
  confirmedRevision: integer("confirmed_revision"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
}, (t) => [
  index("bookings_session_activity_idx").on(t.sessionId, t.lastActivityAt.desc(), t.id.desc()),
  index("bookings_session_source_activity_idx").on(t.sessionId, t.source, t.lastActivityAt.desc(), t.id.desc()),
  index("bookings_import_batch_idx").on(t.importBatchId),
  uniqueIndex("bookings_session_create_request_uq")
    .on(t.sessionId, t.createRequestId)
    .where(sql`${t.createRequestId} is not null`),
]);

export const bookingItems = pgTable("booking_items", {
  id: uuid("id").primaryKey(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  sku: text("sku"),
  description: text("description"),
  hsCode: text("hs_code"),
  quantityUnits: integer("quantity_units"),
  unitPriceGbp: decimal("unit_price_gbp"),
  unitsPerCarton: integer("units_per_carton"),
  cartons: integer("cartons"),
  unitWeightKg: decimal("unit_weight_kg"),
  countryOfOrigin: text("country_of_origin"),
  sourceRow: integer("source_row"),
  rawRow: jsonb("raw_row"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("booking_items_booking_idx").on(t.bookingId, t.position)]);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Monotonic insertion order; stable tiebreak for (created_at, seq) ordering and cursors. */
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => anonymousSessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "event"] }).notNull(),
  content: text("content").notNull(),
  requestId: text("request_id"),
  revision: integer("revision"),
  meta: jsonb("meta"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("chat_messages_booking_order_idx").on(t.bookingId, t.seq),
  index("chat_messages_session_idx").on(t.sessionId),
]);

export const chatTurnRequests = pgTable("chat_turn_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  kind: text("kind", { enum: ["chat", "edit", "confirm"] }).notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  appliedRevision: integer("applied_revision"),
  responseJson: jsonb("response_json"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("chat_turn_requests_booking_request_uq").on(t.bookingId, t.requestId)]);

export const bookingRevisions = pgTable("booking_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  source: text("source", { enum: ["create", "chat", "edit", "import", "confirm"] }).notNull(),
  changePatch: jsonb("change_patch"),
  changedFields: jsonb("changed_fields").notNull(),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("booking_revisions_booking_revision_uq").on(t.bookingId, t.revision)]);

export const evaluations = pgTable("evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  bookingRevision: integer("booking_revision").notNull(),
  engineVersion: text("engine_version").notNull(),
  rateCardVersion: text("rate_card_version").notNull(),
  rulebookVersion: text("rulebook_version").notNull(),
  todayUk: date("today_uk", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  redCount: integer("red_count").notNull(),
  amberCount: integer("amber_count").notNull(),
  findings: jsonb("findings").notNull(),
  carrierSnapshot: jsonb("carrier_snapshot").notNull(),
  missingFields: jsonb("missing_fields").notNull(),
  inputIssues: jsonb("input_issues").notNull(),
  result: jsonb("result").notNull(),
  evaluatedAt: ts("evaluated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("evaluations_booking_revision_uq").on(t.bookingId, t.bookingRevision)]);

export const importIssues = pgTable("import_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  sheet: text("sheet").notNull(),
  sourceRow: integer("source_row"),
  columnName: text("column_name"),
  issueCode: text("issue_code").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  rawValue: text("raw_value"),
}, (t) => [index("import_issues_batch_idx").on(t.batchId), index("import_issues_booking_idx").on(t.bookingId)]);

export const carrierOptions = pgTable("carrier_options", {
  key: text("key").primaryKey(),
  carrier: text("carrier").notNull(),
  service: text("service").notNull(),
  originCountry: text("origin_country").notNull(),
  destinationCountry: text("destination_country").notNull(),
  pricePerPalletGbp: numeric("price_per_pallet_gbp", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  transitDays: integer("transit_days").notNull(),
  onTimePercent: numeric("on_time_percent", { precision: 5, scale: 2 }).notNull(),
  maxKgPerPallet: numeric("max_kg_per_pallet", { precision: 10, scale: 2 }).notNull(),
  rateCardVersion: text("rate_card_version").notNull(),
});

export const ruleDefinitions = pgTable("rule_definitions", {
  ruleId: text("rule_id").primaryKey(),
  description: text("description").notNull(),
  severity: text("severity", { enum: ["Red", "Amber"] }).notNull(),
  rulebookVersion: text("rulebook_version").notNull(),
});
