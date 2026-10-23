-- CreateTable
CREATE TABLE "asia_fares" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "return_date" DATE,
    "nights" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(10,2) NOT NULL,
    "prev_price" DECIMAL(10,2),
    "low_price" DECIMAL(10,2) NOT NULL,
    "high_price" DECIMAL(10,2) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asia_fares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asia_scans" (
    "key" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "found" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "asia_scans_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "asia_fares_date_idx" ON "asia_fares"("date");

-- CreateIndex
CREATE UNIQUE INDEX "asia_fares_kind_origin_city_date_nights_key" ON "asia_fares"("kind", "origin", "city", "date", "nights");
