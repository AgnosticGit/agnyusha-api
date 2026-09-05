-- CreateEnum
CREATE TYPE "public"."DeliveryMethodCode" AS ENUM ('PICKUP', 'COURIER', 'CDEK', 'YANDEX', 'POST');

-- CreateTable
CREATE TABLE "public"."delivery_methods" (
    "id" TEXT NOT NULL,
    "code" "public"."DeliveryMethodCode" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_methods_code_key" ON "public"."delivery_methods"("code");
