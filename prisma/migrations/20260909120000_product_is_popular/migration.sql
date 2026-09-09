-- AlterTable
ALTER TABLE "products" ADD COLUMN "is_popular" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "products_is_popular_is_active_sort_order_idx" ON "products"("is_popular", "is_active", "sort_order");
