-- AlterTable
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3),
ADD COLUMN "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN "last_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "first_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "middle_name" TEXT NOT NULL DEFAULT '';

-- Existing accounts that already had a session are treated as verified.
UPDATE "users"
SET "email_verified_at" = "created_at"
WHERE "id" IN (SELECT DISTINCT "user_id" FROM "sessions");

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "email" TEXT,
ADD COLUMN "last_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "first_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "middle_name" TEXT NOT NULL DEFAULT '';

UPDATE "orders" AS o
SET "email" = u."email"
FROM "users" AS u
WHERE o."user_id" = u."id" AND (o."email" IS NULL OR o."email" = '');

UPDATE "orders" SET "email" = '' WHERE "email" IS NULL;

ALTER TABLE "orders" ALTER COLUMN "email" SET NOT NULL;

-- CreateIndex
CREATE INDEX "orders_email_idx" ON "orders"("email");
