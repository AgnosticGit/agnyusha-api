-- AlterEnum
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PAID';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_external_id" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_pay_link" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3);
