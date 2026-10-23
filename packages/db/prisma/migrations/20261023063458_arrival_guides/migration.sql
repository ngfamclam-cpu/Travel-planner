-- CreateTable
CREATE TABLE "arrival_guides" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "content" JSONB,
    "places" JSONB,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "error" TEXT,
    "generated_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3),

    CONSTRAINT "arrival_guides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arrival_guides_trip_id_key" ON "arrival_guides"("trip_id");

-- AddForeignKey
ALTER TABLE "arrival_guides" ADD CONSTRAINT "arrival_guides_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
