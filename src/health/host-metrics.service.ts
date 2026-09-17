import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  collectHostSnapshot,
  evaluateHostHealth,
  type HostMetricSnapshot,
} from './host-metrics';
import type { HealthStatus } from './health.types';

export const LIVE_SAMPLE_MS = 30_000;
export const LIVE_RING_SIZE = 120;
export const HOURLY_SAMPLE_MS = 60 * 60_000;
export const HOURLY_RETENTION_MS = 3 * 24 * 60 * 60_000;

export type HostMetricsDashboard = {
  current: HostMetricSnapshot;
  live: HostMetricSnapshot[];
  hourly: HostMetricSnapshot[];
};

@Injectable()
export class HostMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HostMetricsService.name);
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private hourlyTimer: ReturnType<typeof setInterval> | null = null;
  private readonly liveRing: HostMetricSnapshot[] = [];
  private latest: HostMetricSnapshot | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (!this.shouldStartLoop()) return;
    void this.sampleLive().catch((err) =>
      this.logger.warn(
        `Initial host sample failed: ${err instanceof Error ? err.message : err}`,
      ),
    );
    void this.persistHourly().catch((err) =>
      this.logger.warn(
        `Initial hourly host sample failed: ${err instanceof Error ? err.message : err}`,
      ),
    );
    this.liveTimer = setInterval(() => {
      void this.sampleLive().catch((err) =>
        this.logger.warn(
          `Live host sample failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }, LIVE_SAMPLE_MS);
    this.hourlyTimer = setInterval(() => {
      void this.persistHourly().catch((err) =>
        this.logger.warn(
          `Hourly host sample failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }, HOURLY_SAMPLE_MS);
    this.logger.log(
      `Host metrics sampler started (live=${LIVE_SAMPLE_MS}ms, hourly=${HOURLY_SAMPLE_MS}ms)`,
    );
  }

  onModuleDestroy() {
    if (this.liveTimer) clearInterval(this.liveTimer);
    if (this.hourlyTimer) clearInterval(this.hourlyTimer);
    this.liveTimer = null;
    this.hourlyTimer = null;
  }

  private shouldStartLoop(): boolean {
    return process.env.NODE_ENV !== 'test';
  }

  private procPath(): string {
    return this.config.get<string>('HOST_PROC_PATH')?.trim() || '/host/proc';
  }

  private rootPath(): string {
    return this.config.get<string>('HOST_ROOT_PATH')?.trim() || '/host/root';
  }

  async collect(): Promise<HostMetricSnapshot> {
    return collectHostSnapshot({
      procPath: this.procPath(),
      rootPath: this.rootPath(),
    });
  }

  async sampleLive(): Promise<HostMetricSnapshot> {
    const snap = await this.collect();
    this.latest = snap;
    this.liveRing.push(snap);
    while (this.liveRing.length > LIVE_RING_SIZE) this.liveRing.shift();
    return snap;
  }

  async persistHourly(): Promise<HostMetricSnapshot> {
    const snap = this.latest ?? (await this.sampleLive());
    const recordedAt = new Date(snap.at);
    await this.prisma.hostMetricHourly.create({
      data: {
        recordedAt,
        memTotalMb: snap.memTotalMb,
        memAvailableMb: snap.memAvailableMb,
        memUsedPct: snap.memUsedPct,
        swapTotalMb: snap.swapTotalMb,
        swapUsedMb: snap.swapUsedMb,
        load1: snap.load1,
        diskTotalMb: snap.diskTotalMb,
        diskUsedPct: snap.diskUsedPct,
        source: snap.source,
      },
    });
    const cutoff = new Date(Date.now() - HOURLY_RETENTION_MS);
    await this.prisma.hostMetricHourly.deleteMany({
      where: { recordedAt: { lt: cutoff } },
    });
    return snap;
  }

  async evaluateCurrent(): Promise<{
    status: HealthStatus;
    message: string;
    snapshot: HostMetricSnapshot;
  }> {
    const snapshot = this.latest ?? (await this.collect());
    if (!this.latest) this.latest = snapshot;
    const { status, message } = evaluateHostHealth(snapshot);
    return { status, message, snapshot };
  }

  async getDashboard(): Promise<HostMetricsDashboard> {
    const current = this.latest ?? (await this.sampleLive());
    const rows = await this.prisma.hostMetricHourly.findMany({
      where: {
        recordedAt: { gte: new Date(Date.now() - HOURLY_RETENTION_MS) },
      },
      orderBy: { recordedAt: 'asc' },
    });
    const hourly: HostMetricSnapshot[] = rows.map((r) => ({
      at: r.recordedAt.toISOString(),
      memTotalMb: r.memTotalMb,
      memAvailableMb: r.memAvailableMb,
      memUsedPct: r.memUsedPct,
      swapTotalMb: r.swapTotalMb,
      swapUsedMb: r.swapUsedMb,
      load1: r.load1,
      diskTotalMb: r.diskTotalMb,
      diskUsedPct: r.diskUsedPct,
      source: r.source === 'host' ? 'host' : 'container',
    }));
    return {
      current,
      live: [...this.liveRing],
      hourly,
    };
  }
}
