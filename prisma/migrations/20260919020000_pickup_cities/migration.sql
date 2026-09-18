-- Cities where store self-pickup is offered (CDEK city snapshots as JSON).
ALTER TABLE "pickup_settings"
  ADD COLUMN IF NOT EXISTS "cities" JSONB NOT NULL DEFAULT '[
    {
      "cdekCode": 137,
      "name": "Санкт-Петербург",
      "region": "Санкт-Петербург",
      "label": "Санкт-Петербург, Санкт-Петербург, Россия"
    }
  ]'::jsonb;

UPDATE "pickup_settings"
SET "cities" = '[
  {
    "cdekCode": 137,
    "name": "Санкт-Петербург",
    "region": "Санкт-Петербург",
    "label": "Санкт-Петербург, Санкт-Петербург, Россия"
  }
]'::jsonb
WHERE "cities" IS NULL
   OR "cities" = 'null'::jsonb
   OR "cities" = '[]'::jsonb;
