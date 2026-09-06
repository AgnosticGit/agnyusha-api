-- Roles (PostgreSQL: new enum values)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'STAFF';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';

-- Staff permissions
DO $$ BEGIN
  CREATE TYPE "StaffPermission" AS ENUM (
    'PRODUCT_CREATE',
    'PRODUCT_DELETE',
    'PRODUCT_EDIT',
    'PRODUCT_STOCK'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "user_permissions" (
    "user_id" TEXT NOT NULL,
    "permission" "StaffPermission" NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission")
);

DO $$ BEGIN
  ALTER TABLE "user_permissions"
    ADD CONSTRAINT "user_permissions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "weight" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_sku_key" ON "product_variants"("sku");
CREATE INDEX IF NOT EXISTS "product_variants_product_id_sort_order_idx" ON "product_variants"("product_id", "sort_order");

DO $$ BEGIN
  ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Backfill variants from JSON (only when legacy column still exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'variants'
  ) THEN
    INSERT INTO "product_variants" ("id", "product_id", "sku", "weight", "price", "stock", "sort_order")
    SELECT
      md5(p.id || ':' || COALESCE(v.ord::text, '0') || ':' || COALESCE(v.weight, '')),
      p.id,
      'AGN-' || UPPER(REPLACE(p.slug, '-', '')) || '-' || LPAD((COALESCE(v.ord, 0) + 1)::text, 2, '0'),
      COALESCE(NULLIF(TRIM(v.weight), ''), '1 кг.'),
      GREATEST(COALESCE((v.price)::int, 0), 0),
      50,
      COALESCE(v.ord, 0)
    FROM "products" p
    CROSS JOIN LATERAL (
      SELECT
        ordinality - 1 AS ord,
        elem->>'weight' AS weight,
        elem->>'price' AS price
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(p.variants::jsonb) = 'array' THEN p.variants::jsonb
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS t(elem, ordinality)
    ) v
    WHERE NOT EXISTS (
      SELECT 1 FROM "product_variants" pv WHERE pv.product_id = p.id
    );

    ALTER TABLE "products" DROP COLUMN "variants";
  END IF;
END $$;

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "variant_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders"("created_at");
