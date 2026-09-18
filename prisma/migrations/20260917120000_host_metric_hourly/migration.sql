-- CreateTable
CREATE TABLE "host_metric_hourly" (
    "id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "mem_total_mb" DOUBLE PRECISION NOT NULL,
    "mem_available_mb" DOUBLE PRECISION NOT NULL,
    "mem_used_pct" DOUBLE PRECISION NOT NULL,
    "swap_total_mb" DOUBLE PRECISION NOT NULL,
    "swap_used_mb" DOUBLE PRECISION NOT NULL,
    "load1" DOUBLE PRECISION NOT NULL,
    "disk_total_mb" DOUBLE PRECISION NOT NULL,
    "disk_used_pct" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "host_metric_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_metric_hourly_recorded_at_idx" ON "host_metric_hourly"("recorded_at");
