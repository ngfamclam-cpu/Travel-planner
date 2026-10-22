-- AlterTable
ALTER TABLE "events" ADD COLUMN     "ticket_target" DECIMAL(10,2),
ADD COLUMN     "ticket_tier_hint" TEXT;

-- CreateTable
CREATE TABLE "ticket_watches" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT,
    "external_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'needs_link',
    "last_error" TEXT,
    "official_state" TEXT,
    "find_tried" BOOLEAN NOT NULL DEFAULT false,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_prices" (
    "id" TEXT NOT NULL,
    "watch_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "listed_price" DECIMAL(10,2) NOT NULL,
    "all_in_price" DECIMAL(10,2) NOT NULL,
    "fees_included" BOOLEAN NOT NULL,
    "fees_estimated" BOOLEAN NOT NULL,
    "highest_bid" DECIMAL(10,2),
    "tier_label" TEXT,
    "source" TEXT NOT NULL,
    "risky" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "note" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "ticket_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_watches_event_id_platform_key" ON "ticket_watches"("event_id", "platform");

-- CreateIndex
CREATE INDEX "ticket_prices_event_id_observed_at_idx" ON "ticket_prices"("event_id", "observed_at");

-- AddForeignKey
ALTER TABLE "ticket_watches" ADD CONSTRAINT "ticket_watches_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_prices" ADD CONSTRAINT "ticket_prices_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "ticket_watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_prices" ADD CONSTRAINT "ticket_prices_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
