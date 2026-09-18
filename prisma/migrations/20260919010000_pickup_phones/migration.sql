-- Contact phones for store self-pickup (admin-editable list).
ALTER TABLE "pickup_settings"
  ADD COLUMN IF NOT EXISTS "phones" TEXT[] NOT NULL DEFAULT ARRAY['+7 (911) 228-31-92']::TEXT[];

UPDATE "pickup_settings"
SET "phones" = ARRAY['+7 (911) 228-31-92']::TEXT[]
WHERE "phones" IS NULL OR cardinality("phones") = 0;

-- Snapshot of pickup contact phones at order time.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "store_pickup_phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
