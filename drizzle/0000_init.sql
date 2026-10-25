CREATE TABLE "anonymous_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "anonymous_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "booking_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"sku" text,
	"description" text,
	"hs_code" text,
	"quantity_units" integer,
	"unit_price_gbp" numeric(14, 4),
	"units_per_carton" integer,
	"cartons" integer,
	"unit_weight_kg" numeric(14, 4),
	"country_of_origin" text,
	"source_row" integer,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"source" text NOT NULL,
	"change_patch" jsonb,
	"changed_fields" jsonb NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"source" text NOT NULL,
	"create_request_id" text,
	"external_booking_id" text,
	"title" text NOT NULL,
	"seller_name" text,
	"origin_city" text,
	"origin_country" text DEFAULT 'United Kingdom' NOT NULL,
	"destination_city" text,
	"destination_country" text,
	"destination_type" text,
	"ready_to_ship_date" date,
	"ready_date_note" text,
	"seller_priority" text,
	"pallets" integer,
	"cartons" integer,
	"total_declared_value_gbp" numeric(14, 4),
	"currency" text DEFAULT 'GBP' NOT NULL,
	"total_gross_weight_kg" numeric(14, 4),
	"delivery_appointment_booked" boolean,
	"selected_carrier_key" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"red_count" integer DEFAULT 0 NOT NULL,
	"amber_count" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"source_row" integer,
	"raw_row" jsonb,
	"confirmed_at" timestamp with time zone,
	"confirmed_revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_options" (
	"key" text PRIMARY KEY NOT NULL,
	"carrier" text NOT NULL,
	"service" text NOT NULL,
	"origin_country" text NOT NULL,
	"destination_country" text NOT NULL,
	"price_per_pallet_gbp" numeric(10, 2) NOT NULL,
	"currency" text NOT NULL,
	"transit_days" integer NOT NULL,
	"on_time_percent" numeric(5, 2) NOT NULL,
	"max_kg_per_pallet" numeric(10, 2) NOT NULL,
	"rate_card_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"booking_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"request_id" text,
	"revision" integer,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_turn_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"applied_revision" integer,
	"response_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"booking_revision" integer NOT NULL,
	"engine_version" text NOT NULL,
	"rate_card_version" text NOT NULL,
	"rulebook_version" text NOT NULL,
	"today_uk" date NOT NULL,
	"status" text NOT NULL,
	"red_count" integer NOT NULL,
	"amber_count" integer NOT NULL,
	"findings" jsonb NOT NULL,
	"carrier_snapshot" jsonb NOT NULL,
	"missing_fields" jsonb NOT NULL,
	"input_issues" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"original_filename_sanitized" text NOT NULL,
	"booking_row_count" integer NOT NULL,
	"item_row_count" integer NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"booking_id" uuid,
	"sheet" text NOT NULL,
	"source_row" integer,
	"column_name" text,
	"issue_code" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"raw_value" text
);
--> statement-breakpoint
CREATE TABLE "rule_definitions" (
	"rule_id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"rulebook_version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_revisions" ADD CONSTRAINT "booking_revisions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_anonymous_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."anonymous_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_anonymous_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."anonymous_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turn_requests" ADD CONSTRAINT "chat_turn_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_session_id_anonymous_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."anonymous_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_issues" ADD CONSTRAINT "import_issues_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_issues" ADD CONSTRAINT "import_issues_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anonymous_sessions_expires_idx" ON "anonymous_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "booking_items_booking_idx" ON "booking_items" USING btree ("booking_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_revisions_booking_revision_uq" ON "booking_revisions" USING btree ("booking_id","revision");--> statement-breakpoint
CREATE INDEX "bookings_session_activity_idx" ON "bookings" USING btree ("session_id","last_activity_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bookings_session_source_activity_idx" ON "bookings" USING btree ("session_id","source","last_activity_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bookings_import_batch_idx" ON "bookings" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_session_create_request_uq" ON "bookings" USING btree ("session_id","create_request_id") WHERE "bookings"."create_request_id" is not null;--> statement-breakpoint
CREATE INDEX "chat_messages_booking_order_idx" ON "chat_messages" USING btree ("booking_id","seq");--> statement-breakpoint
CREATE INDEX "chat_messages_session_idx" ON "chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turn_requests_booking_request_uq" ON "chat_turn_requests" USING btree ("booking_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_booking_revision_uq" ON "evaluations" USING btree ("booking_id","booking_revision");--> statement-breakpoint
CREATE INDEX "import_batches_session_idx" ON "import_batches" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "import_issues_batch_idx" ON "import_issues" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "import_issues_booking_idx" ON "import_issues" USING btree ("booking_id");