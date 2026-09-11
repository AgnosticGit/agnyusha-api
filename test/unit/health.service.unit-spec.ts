import { HealthService } from '../../src/health/health.service';
import type { AuthService } from '../../src/auth/auth.service';
import type { CdekService } from '../../src/cdek/cdek.service';
import type { ResendMailService } from '../../src/mail/resend-mail.service';
import type { PaymentsService } from '../../src/payments/payments.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { PochtaService } from '../../src/pochta/pochta.service';
import type { OzonDeliveryService } from '../../src/ozon-delivery/ozon-delivery.service';
import type { YandexDeliveryService } from '../../src/yandex/yandex-delivery.service';
import type { DeliveryTrackingPoller } from '../../src/orders/delivery-tracking.poller';
import type { DeliveryPollSnapshot } from '../../src/orders/delivery-poll.util';

type Deps = {
  prisma: { $queryRaw: jest.Mock };
  cdek: { isConfigured: jest.Mock; ping: jest.Mock };
  yandex: {
    isConfigured: jest.Mock;
    isOrderCreationConfigured: jest.Mock;
    ping: jest.Mock;
  };
  pochta: {
    isConfigured: jest.Mock;
    isOrderCreationConfigured: jest.Mock;
    ping: jest.Mock;
  };
  ozonDelivery: {
    isConfigured: jest.Mock;
    isOrderCreationConfigured: jest.Mock;
    ping: jest.Mock;
  };
  payments: { isConfigured: jest.Mock; ping: jest.Mock };
  auth: { isGoogleConfigured: jest.Mock };
  mail: { isConfigured: jest.Mock };
  poller: { snapshot: jest.Mock };
};

function idleSnapshot(
  carrier: DeliveryPollSnapshot['carrier'],
): DeliveryPollSnapshot {
  return {
    carrier,
    enabled: true,
    intervalMs: 60 * 60_000,
    gapMs: 2500,
    activeCount: 0,
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastError: null,
  };
}

function makeService(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    prisma: {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      ...overrides.prisma,
    },
    cdek: {
      isConfigured: jest.fn().mockReturnValue(false),
      ping: jest.fn().mockResolvedValue(undefined),
      ...overrides.cdek,
    },
    yandex: {
      isConfigured: jest.fn().mockReturnValue(false),
      isOrderCreationConfigured: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue(undefined),
      ...overrides.yandex,
    },
    pochta: {
      isConfigured: jest.fn().mockReturnValue(false),
      isOrderCreationConfigured: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue(undefined),
      ...overrides.pochta,
    },
    ozonDelivery: {
      isConfigured: jest.fn().mockReturnValue(false),
      isOrderCreationConfigured: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue(undefined),
      ...overrides.ozonDelivery,
    },
    payments: {
      isConfigured: jest.fn().mockReturnValue(false),
      ping: jest.fn().mockResolvedValue({ ok: true, message: 'ok' }),
      ...overrides.payments,
    },
    auth: {
      isGoogleConfigured: jest.fn().mockReturnValue(false),
      ...overrides.auth,
    },
    mail: {
      isConfigured: jest.fn().mockReturnValue(false),
      ...overrides.mail,
    },
    poller: {
      snapshot: jest
        .fn()
        .mockImplementation(async (carrier: DeliveryPollSnapshot['carrier']) =>
          idleSnapshot(carrier),
        ),
      ...overrides.poller,
    },
  };

  const service = new HealthService(
    deps.prisma as unknown as PrismaService,
    deps.cdek as unknown as CdekService,
    deps.yandex as unknown as YandexDeliveryService,
    deps.pochta as unknown as PochtaService,
    deps.ozonDelivery as unknown as OzonDeliveryService,
    deps.payments as unknown as PaymentsService,
    deps.auth as unknown as AuthService,
    deps.mail as unknown as ResendMailService,
    deps.poller as unknown as DeliveryTrackingPoller,
  );

  return { service, deps };
}

describe('HealthService', () => {
  describe('live', () => {
    it('returns ok status', () => {
      const { service } = makeService();
      expect(service.live()).toEqual({
        status: 'ok',
        service: 'agnyusha-api',
      });
    });
  });

  describe('ready', () => {
    it('is ok when database probe succeeds', async () => {
      const { service } = makeService();
      const result = await service.ready();
      expect(result.status).toBe('ok');
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0]).toMatchObject({
        id: 'database',
        status: 'ok',
        critical: true,
      });
    });

    it('is down when database probe fails', async () => {
      const { service } = makeService({
        prisma: {
          $queryRaw: jest.fn().mockRejectedValue(new Error('db down')),
        },
      });
      const result = await service.ready();
      expect(result.status).toBe('down');
      expect(result.checks[0].status).toBe('down');
      expect(result.checks[0].message).toContain('db down');
    });
  });

  describe('fullReport', () => {
    it('is ok when critical checks pass and optional are skipped', async () => {
      const { service } = makeService();
      const report = await service.fullReport();
      expect(report.status).toBe('ok');
      expect(report.checkedAt).toEqual(expect.any(String));
      expect(report.checks.map((c) => c.id)).toEqual([
        'database',
        'uploads',
        'cdek',
        'yandex',
        'pochta',
        'ozon_delivery',
        'ozon_pay',
        'mail',
        'google_oauth',
      ]);
      expect(
        report.checks
          .filter((c) => c.configured === false)
          .every((c) => c.status === 'skipped'),
      ).toBe(true);
    });

    it('is down when a critical check is down', async () => {
      const { service } = makeService({
        prisma: {
          $queryRaw: jest.fn().mockRejectedValue(new Error('pg unavailable')),
        },
      });
      const report = await service.fullReport();
      expect(report.status).toBe('down');
      expect(report.checks.find((c) => c.id === 'database')?.status).toBe(
        'down',
      );
    });

    it('is degraded when a non-critical check is down', async () => {
      const { service } = makeService({
        cdek: {
          isConfigured: jest.fn().mockReturnValue(true),
          ping: jest.fn().mockRejectedValue(new Error('cdek oauth failed')),
        },
      });
      const report = await service.fullReport();
      expect(report.status).toBe('degraded');
      expect(report.checks.find((c) => c.id === 'cdek')?.status).toBe('down');
      expect(report.checks.find((c) => c.id === 'database')?.status).toBe('ok');
    });

    it('marks yandex degraded when order creation is not configured', async () => {
      const { service } = makeService({
        yandex: {
          isConfigured: jest.fn().mockReturnValue(true),
          isOrderCreationConfigured: jest.fn().mockReturnValue(false),
          ping: jest.fn().mockResolvedValue(undefined),
        },
      });
      const report = await service.fullReport();
      expect(report.status).toBe('degraded');
      expect(report.checks.find((c) => c.id === 'yandex')).toMatchObject({
        status: 'degraded',
        configured: true,
      });
      expect(report.checks.find((c) => c.id === 'yandex')?.message).toContain(
        'YANDEX_PLATFORM_STATION_ID',
      );
    });

    it('marks pochta degraded when FROM_INDEX is missing', async () => {
      const { service } = makeService({
        pochta: {
          isConfigured: jest.fn().mockReturnValue(true),
          isOrderCreationConfigured: jest.fn().mockReturnValue(false),
          ping: jest.fn().mockResolvedValue(undefined),
        },
      });
      const report = await service.fullReport();
      expect(report.status).toBe('degraded');
      expect(report.checks.find((c) => c.id === 'pochta')).toMatchObject({
        status: 'degraded',
        configured: true,
        message: expect.stringContaining('POCHTA_FROM_INDEX'),
      });
    });

    it('appends poll stats and degrades when the queue cannot keep up', async () => {
      const { service } = makeService({
        cdek: {
          isConfigured: jest.fn().mockReturnValue(true),
          ping: jest.fn().mockResolvedValue(undefined),
        },
        poller: {
          snapshot: jest.fn().mockResolvedValue({
            ...idleSnapshot('CDEK'),
            activeCount: 5000,
            lastSuccessAt: new Date('2026-09-11T13:03:00.000Z'),
          }),
        },
      });
      const report = await service.fullReport();
      const cdek = report.checks.find((c) => c.id === 'cdek');
      expect(report.status).toBe('degraded');
      expect(cdek?.status).toBe('degraded');
      expect(cdek?.message).toContain('OAuth токен получен');
      expect(cdek?.message).toContain('очередь 5000');
      expect(cdek?.message).toContain('2026-09-11T13:03:00.000Z');
      expect(cdek?.message).toContain('не укладывается в интервал');
    });
  });
});
