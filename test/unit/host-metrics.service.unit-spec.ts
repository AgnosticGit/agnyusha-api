import { ConfigService } from '@nestjs/config';
import {
  HostMetricsService,
  HOURLY_RETENTION_MS,
  LIVE_RING_SIZE,
} from '../../src/health/host-metrics.service';
import * as hostMetrics from '../../src/health/host-metrics';
import type { PrismaService } from '../../src/prisma/prisma.service';

describe('HostMetricsService', () => {
  const snap = (at: string) =>
    hostMetrics.buildSnapshotFromParts({
      at: new Date(at),
      memTotalMb: 956,
      memAvailableMb: 400,
      swapTotalMb: 2048,
      swapUsedMb: 100,
      load1: 0.2,
      diskTotalMb: 8000,
      diskUsedPct: 55,
      source: 'host',
    });

  function makeService() {
    const create = jest.fn().mockResolvedValue({});
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      hostMetricHourly: { create, deleteMany, findMany },
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'HOST_PROC_PATH'
          ? '/host/proc'
          : key === 'HOST_ROOT_PATH'
            ? '/host/root'
            : undefined,
      ),
    };
    const service = new HostMetricsService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
    return { service, create, deleteMany, findMany, config };
  }

  it('keeps a bounded live ring', async () => {
    const { service } = makeService();
    jest
      .spyOn(hostMetrics, 'collectHostSnapshot')
      .mockImplementation(async () => snap(new Date().toISOString()));

    for (let i = 0; i < LIVE_RING_SIZE + 5; i++) {
      await service.sampleLive();
    }
    const dash = await service.getDashboard();
    expect(dash.live).toHaveLength(LIVE_RING_SIZE);
  });

  it('persists hourly and prunes older than retention', async () => {
    const { service, create, deleteMany } = makeService();
    jest
      .spyOn(hostMetrics, 'collectHostSnapshot')
      .mockResolvedValue(snap('2026-09-17T12:00:00.000Z'));

    await service.sampleLive();
    await service.persistHourly();

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memAvailableMb: 400,
        source: 'host',
      }),
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        recordedAt: {
          lt: expect.any(Date),
        },
      },
    });
    const cutoff = (deleteMany.mock.calls[0][0] as {
      where: { recordedAt: { lt: Date } };
    }).where.recordedAt.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(
      HOURLY_RETENTION_MS - 5_000,
    );
  });
});
