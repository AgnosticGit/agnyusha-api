-- AlterTable
ALTER TABLE "products" ADD COLUMN "badge_label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "products" ADD COLUMN "badge_color" TEXT NOT NULL DEFAULT '';

-- Backfill from legacy enum
UPDATE "products" SET "badge_label" = 'Хит', "badge_color" = '#5fa88a' WHERE "badge" = 'HIT';
UPDATE "products" SET "badge_label" = 'Новинка', "badge_color" = '#e0f0e8' WHERE "badge" = 'NEW';
UPDATE "products"
SET
  "badge_label" = CASE
    WHEN "discount_percent" IS NOT NULL THEN '-' || "discount_percent"::text || '%'
    ELSE 'Скидка'
  END,
  "badge_color" = '#c45c26'
WHERE "badge" = 'SALE';
