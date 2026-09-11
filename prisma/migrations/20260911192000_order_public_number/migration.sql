-- Public order numbers for customers/support (cuid remains PK).
-- Start at 10001 so early orders don't look like "№ 1".

CREATE SEQUENCE "orders_number_seq" START WITH 10001;

ALTER TABLE "orders" ADD COLUMN "number" INTEGER;

UPDATE "orders" AS o
SET "number" = s.n
FROM (
  SELECT
    id,
    10000 + ROW_NUMBER() OVER (ORDER BY "created_at" ASC, id ASC) AS n
  FROM "orders"
) AS s
WHERE o.id = s.id;

SELECT setval(
  'orders_number_seq',
  GREATEST(
    10000,
    COALESCE((SELECT MAX("number") FROM "orders"), 10000)
  )
);

ALTER TABLE "orders" ALTER COLUMN "number" SET DEFAULT nextval('orders_number_seq');
ALTER TABLE "orders" ALTER COLUMN "number" SET NOT NULL;
ALTER SEQUENCE "orders_number_seq" OWNED BY "orders"."number";

CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");
