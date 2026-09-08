-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN     "delivery_status_at" TIMESTAMP(3),
ADD COLUMN     "delivery_status_code" TEXT,
ADD COLUMN     "delivery_status_label" TEXT,
ADD COLUMN     "delivery_track_number" TEXT,
ADD COLUMN     "delivery_tracking_url" TEXT;
