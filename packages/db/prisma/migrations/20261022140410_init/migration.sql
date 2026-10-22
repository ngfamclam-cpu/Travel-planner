-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('announced', 'on_sale', 'sold_out', 'cancelled', 'past');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('considering', 'planned', 'booked', 'done');

-- CreateEnum
CREATE TYPE "LineItemKind" AS ENUM ('flight', 'hotel', 'ticket', 'ground', 'food', 'other');

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "region" TEXT NOT NULL DEFAULT 'US',
    "venue" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "dates_tentative" BOOLEAN NOT NULL DEFAULT false,
    "genres" TEXT[],
    "lineup_highlights" TEXT[],
    "airports" TEXT[],
    "drivable_from_boston" BOOLEAN NOT NULL DEFAULT false,
    "official_url" TEXT,
    "ticket_url" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" "EventStatus" NOT NULL DEFAULT 'announced',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tiers" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier_label" TEXT,
    "price_all_in" DECIMAL(10,2),
    "fees_included" BOOLEAN NOT NULL DEFAULT true,
    "is_resale" BOOLEAN NOT NULL DEFAULT false,
    "on_sale" BOOLEAN NOT NULL DEFAULT false,
    "sold_out" BOOLEAN NOT NULL DEFAULT false,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "source_url" TEXT,

    CONSTRAINT "ticket_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event_id" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'considering',
    "slot" TEXT,
    "color" TEXT NOT NULL DEFAULT '#a855f7',
    "arrive_date" DATE NOT NULL,
    "depart_date" DATE NOT NULL,
    "flex_days" INTEGER NOT NULL DEFAULT 2,
    "notes" TEXT,
    "chosen_option" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_items" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "kind" "LineItemKind" NOT NULL,
    "label" TEXT NOT NULL,
    "est_amount" DECIMAL(10,2),
    "quoted_amount" DECIMAL(10,2),
    "booked_amount" DECIMAL(10,2),
    "qty" INTEGER NOT NULL DEFAULT 1,
    "is_estimate" BOOLEAN NOT NULL DEFAULT true,
    "quoted_source" TEXT,
    "quoted_at" TIMESTAMP(3),
    "quoted_url" TEXT,
    "insight_label" TEXT,
    "search_spec" JSONB,
    "baseline_price" DECIMAL(10,2),
    "baseline_at" TIMESTAMP(3),
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "card_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "line_item_id" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "variant" TEXT,
    "is_baseline" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "positioning_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "origin" TEXT,
    "destination" TEXT,
    "outbound_date" DATE,
    "return_date" DATE,
    "cabin" TEXT,
    "stops" INTEGER,
    "carrier" TEXT,
    "hotel_name" TEXT,
    "stars" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION,
    "insight_label" TEXT,
    "booking_url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "foreign_fee_pct" DECIMAL(4,2),
    "points_currency" TEXT,
    "transfer_enabled" BOOLEAN,
    "earn_rules" JSONB NOT NULL,
    "version" TEXT,
    "needs_setup" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_balances" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "points_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_partners" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "ratio" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL DEFAULT 'airline',
    "notes" TEXT,

    CONSTRAINT "transfer_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemptions" (
    "id" TEXT NOT NULL,
    "line_item_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "taxes_fees" DECIMAL(10,2) NOT NULL,
    "cash_price" DECIMAL(10,2) NOT NULL,
    "cpp" DECIMAL(6,2) NOT NULL,
    "verdict" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefs" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "payload" JSONB,
    "sent_push" BOOLEAN NOT NULL DEFAULT false,
    "sent_email" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "savings_meter" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "line_item_id" TEXT NOT NULL,
    "free_best_price" DECIMAL(10,2),
    "paid_best_price" DECIMAL(10,2),

    CONSTRAINT "savings_meter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_runs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "queries" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_cache" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_cache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_name_start_date_key" ON "events"("name", "start_date");

-- CreateIndex
CREATE INDEX "ticket_tiers_event_id_idx" ON "ticket_tiers"("event_id");

-- CreateIndex
CREATE INDEX "line_items_trip_id_idx" ON "line_items"("trip_id");

-- CreateIndex
CREATE INDEX "price_snapshots_line_item_id_fetched_at_idx" ON "price_snapshots"("line_item_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "cards_name_key" ON "cards"("name");

-- CreateIndex
CREATE UNIQUE INDEX "points_balances_currency_key" ON "points_balances"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_partners_currency_partner_key" ON "transfer_partners"("currency", "partner");

-- CreateIndex
CREATE UNIQUE INDEX "briefs_date_key" ON "briefs"("date");

-- CreateIndex
CREATE INDEX "provider_runs_provider_started_at_idx" ON "provider_runs"("provider", "started_at");

-- AddForeignKey
ALTER TABLE "ticket_tiers" ADD CONSTRAINT "ticket_tiers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_meter" ADD CONSTRAINT "savings_meter_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
