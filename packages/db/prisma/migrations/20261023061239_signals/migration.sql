-- AlterTable
ALTER TABLE "line_items" ADD COLUMN     "signal" TEXT,
ADD COLUMN     "signal_at" TIMESTAMP(3),
ADD COLUMN     "signal_changed_at" TIMESTAMP(3),
ADD COLUMN     "signal_reason" TEXT;
