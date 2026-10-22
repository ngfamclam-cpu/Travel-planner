-- AlterTable
ALTER TABLE "line_items" ADD COLUMN     "booking" JSONB;

-- AlterTable
ALTER TABLE "price_snapshots" ADD COLUMN     "rank" INTEGER,
ADD COLUMN     "refundable" BOOLEAN;

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "line_item_id" TEXT,
    "trip_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "amount" DECIMAL(10,2),
    "url" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alerts_dedupe_key_key" ON "alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "alerts_dismissed_at_created_at_idx" ON "alerts"("dismissed_at", "created_at");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
