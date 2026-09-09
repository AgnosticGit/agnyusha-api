-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN "weight_grams" INTEGER NOT NULL DEFAULT 800;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "weight_grams" INTEGER NOT NULL DEFAULT 800;
