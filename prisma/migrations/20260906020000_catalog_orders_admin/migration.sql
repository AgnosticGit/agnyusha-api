-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."ProductCategory" AS ENUM ('DOGS', 'CATS');

-- CreateEnum
CREATE TYPE "public"."ProductBadge" AS ENUM ('NONE', 'HIT', 'NEW', 'SALE');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('NEW', 'CONFIRMED', 'SHIPPED', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN "role" "public"."UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "public"."products" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL,
    "category" "public"."ProductCategory" NOT NULL,
    "badge" "public"."ProductBadge" NOT NULL DEFAULT 'NONE',
    "discount_percent" INTEGER,
    "ingredients" TEXT NOT NULL DEFAULT '',
    "additives" TEXT NOT NULL DEFAULT '',
    "variants" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'NEW',
    "phone" TEXT NOT NULL,
    "contact_channel" TEXT NOT NULL,
    "city_label" TEXT NOT NULL,
    "delivery_code" TEXT NOT NULL,
    "delivery_title" TEXT NOT NULL,
    "pickup_label" TEXT,
    "total" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "weight" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "public"."products"("slug");

-- CreateIndex
CREATE INDEX "products_category_is_active_sort_order_idx" ON "public"."products"("category", "is_active", "sort_order");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "public"."orders"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
