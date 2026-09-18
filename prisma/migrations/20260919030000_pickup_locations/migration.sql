-- Manual city+address locations for store pickup.
ALTER TABLE "pickup_settings"
  ADD COLUMN IF NOT EXISTS "locations" JSONB NOT NULL DEFAULT '[
    {"city":"Санкт-Петербург","address":"Гранитная 51"}
  ]'::jsonb;

UPDATE "pickup_settings"
SET "locations" = jsonb_build_array(
  jsonb_build_object(
    'city',
    CASE
      WHEN "address" IS NOT NULL AND position(',' in "address") > 0
        THEN btrim(split_part("address", ',', 1))
      ELSE 'Санкт-Петербург'
    END,
    'address',
    CASE
      WHEN "address" IS NOT NULL AND position(',' in "address") > 0
        THEN btrim(substr("address", position(',' in "address") + 1))
      WHEN "address" IS NOT NULL AND btrim("address") <> ''
        THEN btrim("address")
      ELSE 'Гранитная 51'
    END
  )
)
WHERE "locations" IS NULL
   OR "locations" = 'null'::jsonb
   OR "locations" = '[]'::jsonb;

ALTER TABLE "pickup_settings" DROP COLUMN IF EXISTS "cities";
