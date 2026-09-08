-- Allow fractional ruble prices (e.g. 0.5 ₽ for payment tests).
ALTER TABLE "product_variants"
  ALTER COLUMN "price" TYPE DOUBLE PRECISION
  USING "price"::double precision;

ALTER TABLE "order_items"
  ALTER COLUMN "price" TYPE DOUBLE PRECISION
  USING "price"::double precision;

ALTER TABLE "orders"
  ALTER COLUMN "total" TYPE DOUBLE PRECISION
  USING "total"::double precision;

UPDATE "product_variants" SET "price" = 0.5;
