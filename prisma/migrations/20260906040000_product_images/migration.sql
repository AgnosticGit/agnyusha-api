-- AlterTable
ALTER TABLE "products" ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill gallery from cover image
UPDATE "products"
SET "images" = ARRAY["image"]
WHERE COALESCE(cardinality("images"), 0) = 0
  AND "image" IS NOT NULL
  AND "image" <> '';
