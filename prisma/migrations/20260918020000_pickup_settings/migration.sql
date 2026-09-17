-- AlterEnum
ALTER TYPE "StaffPermission" ADD VALUE IF NOT EXISTS 'PICKUP_MANAGE';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "store_pickup_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "store_pickup_address" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "pickup_settings" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "min_lead_days" INTEGER NOT NULL DEFAULT 1,
    "schedule" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickup_settings_pkey" PRIMARY KEY ("id")
);

-- Seed default store pickup (Гранитная 51, пн–сб 12:00–14:00)
INSERT INTO "pickup_settings" ("id", "address", "min_lead_days", "schedule", "updated_at")
VALUES (
  'default',
  'Санкт-Петербург, Гранитная 51',
  1,
  '[
    {"weekday":0,"open":false,"startTime":"12:00","endTime":"14:00"},
    {"weekday":1,"open":true,"startTime":"12:00","endTime":"14:00"},
    {"weekday":2,"open":true,"startTime":"12:00","endTime":"14:00"},
    {"weekday":3,"open":true,"startTime":"12:00","endTime":"14:00"},
    {"weekday":4,"open":true,"startTime":"12:00","endTime":"14:00"},
    {"weekday":5,"open":true,"startTime":"12:00","endTime":"14:00"},
    {"weekday":6,"open":true,"startTime":"12:00","endTime":"14:00"}
  ]'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
