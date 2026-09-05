-- CreateEnum
CREATE TYPE "public"."DeliveryMethodCode" AS ENUM ('PICKUP', 'COURIER', 'CDEK', 'POST');

-- CreateTable
CREATE TABLE "public"."cities" (
    "id" TEXT NOT NULL,
    "object_level" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oktmo" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "mun_upper" TEXT,
    "mun_lower" TEXT,
    "settlement" TEXT,
    "population" INTEGER NOT NULL DEFAULT 0,
    "fias_id" TEXT,
    "settlement_type" TEXT,
    "settlement_type_full" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "search_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "cities_oktmo_key" ON "public"."cities"("oktmo");

-- CreateIndex
CREATE INDEX "cities_region_idx" ON "public"."cities"("region");

-- CreateIndex
CREATE INDEX "cities_population_idx" ON "public"."cities"("population" DESC);

-- CreateIndex
CREATE INDEX "cities_name_idx" ON "public"."cities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_methods_code_key" ON "public"."delivery_methods"("code");
