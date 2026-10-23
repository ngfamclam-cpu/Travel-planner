-- AlterTable
ALTER TABLE "events" ADD COLUMN     "hero_media_id" TEXT,
ADD COLUMN     "icon_media_id" TEXT,
ADD COLUMN     "images_checked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "price_snapshots" ADD COLUMN     "image_url" TEXT;

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_key_key" ON "media"("key");
