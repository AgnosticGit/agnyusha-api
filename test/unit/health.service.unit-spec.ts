import { HealthService } from '../../src/health/health.service';
import type { AuthService } from '../../src/auth/auth.service';
import type { CdekService } from '../../src/cdek/cdek.service';
import type { ResendMailService } from '../../src/mail/resend-mail.service';
import type { PaymentsService } from '../../src/payments/payments.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { YandexDeliveryService } from '../../src/yandex/yandex-delivery.service';

type Deps = {
  prisma: { $queryRaw: jest.Mock };
  cdek: { isConfigured: jest.Mock; ping: jest.Mock };
  yandex: {
    isConfigured: jest.Mock;
    isOrderCreationConfigured: jest.Mock;
    ping: jest.Mock;
  };
  payments: { isConfigured: jest.Mock; ping: jest.Mock };
  auth: { isGoogleConfigured: jest.Mock };
  mail: { isConfigured: jest.Mock };
};

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
  };

  const service = new HealthService(
    deps.prisma as unknown as PrismaService,
    deps.cdek as unknown as CdekService,
    deps.yandex as unknown as YandexDeliveryService,
    deps.payments as unknown as PaymentsService,
    deps.auth as unknown as AuthService,
    deps.mail as unknown as ResendMailService,
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
        'ozon_pay',
        'mail',
        'google_oauth',
      ]);
      expect(
        report.checks.filter((c) => c.configured === false).every((c) => c.status === 'skipped'),
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
    });
  });
});
