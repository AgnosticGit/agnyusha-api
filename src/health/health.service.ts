import { Injectable, Logger } from '@nestjs/common';
import { access, constants, mkdir } from 'fs/promises';
import { join } from 'path';
import { AuthService } from '../auth/auth.service';
import { CdekService } from '../cdek/cdek.service';
import { withTimeout } from '../common/http-utils';
import { ResendMailService } from '../mail/resend-mail.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { PochtaService } from '../pochta/pochta.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import type {
  HealthCheckItem,
  HealthReport,
  HealthStatus,
} from './health.types';

const PROBE_TIMEOUT_MS = 5_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cdek: CdekService,
    private readonly yandex: YandexDeliveryService,
    private readonly pochta: PochtaService,
    private readonly payments: PaymentsService,
    private readonly auth: AuthService,
    private readonly mail: ResendMailService,
  ) {}

  live() {
    return { status: 'ok' as const, service: 'agnyusha-api' };
  }

  async ready(): Promise<{ status: 'ok' | 'down'; checks: HealthCheckItem[] }> {
    const database = await this.checkDatabase();
    const status = database.status === 'ok' ? 'ok' : 'down';
    return { status, checks: [database] };
  }

  async fullReport(): Promise<HealthReport> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkUploadsDisk(),
      this.checkCdek(),
      this.checkYandex(),
      this.checkPochta(),
      this.checkOzonPay(),
      this.checkMail(),
      this.checkGoogle(),
    ]);

    return {
      status: this.aggregate(checks),
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  private aggregate(checks: HealthCheckItem[]): HealthReport['status'] {
    if (checks.some((c) => c.critical && c.status === 'down')) return 'down';
    if (checks.some((c) => c.status === 'down' || c.status === 'degraded')) {
      return 'degraded';
    }
    return 'ok';
  }

  private async runCheck(
    id: string,
    name: string,
    critical: boolean,
    configured: boolean,
    probe: () => Promise<{ status: HealthStatus; message?: string | null }>,
  ): Promise<HealthCheckItem> {
    if (!configured) {
      return {
        id,
        name,
        status: 'skipped',
        critical,
        configured: false,
        latencyMs: null,
        message: 'Не настроено',
      };
    }

    const started = Date.now();
    try {
      const result = await withTimeout(probe(), PROBE_TIMEOUT_MS, id);
      return {
        id,
        name,
        status: result.status,
        critical,
        configured: true,
        latencyMs: Date.now() - started,
        message: result.message ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка проверки';
      this.logger.warn(`Health check ${id} failed: ${message}`);
      return {
        id,
        name,
        status: 'down',
        critical,
        configured: true,
        latencyMs: Date.now() - started,
        message,
      };
    }
  }

  private async checkDatabase(): Promise<HealthCheckItem> {
    return this.runCheck('database', 'PostgreSQL', true, true, async () => {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', message: 'Подключение активно' };
    });
  }

  private async checkUploadsDisk(): Promise<HealthCheckItem> {
    const dir = join(process.cwd(), 'uploads');
    return this.runCheck('uploads', 'Файлы uploads/', true, true, async () => {
      await mkdir(dir, { recursive: true });
      await access(dir, constants.R_OK | constants.W_OK);
      return { status: 'ok', message: dir };
    });
  }

  private async checkCdek(): Promise<HealthCheckItem> {
    return this.runCheck(
      'cdek',
      'СДЭК',
      false,
      this.cdek.isConfigured(),
      async () => {
        await this.cdek.ping();
        return { status: 'ok', message: 'OAuth токен получен' };
      },
    );
  }

  private async checkYandex(): Promise<HealthCheckItem> {
    return this.runCheck(
      'yandex',
      'Яндекс Доставка',
      false,
      this.yandex.isConfigured(),
      async () => {
        await this.yandex.ping();
        const orderReady = this.yandex.isOrderCreationConfigured();
        return {
          status: orderReady ? 'ok' : 'degraded',
          message: orderReady
            ? 'API отвечает'
            : 'Токен есть, но YANDEX_PLATFORM_STATION_ID не задан',
        };
      },
    );
  }

  private async checkPochta(): Promise<HealthCheckItem> {
    return this.runCheck(
      'pochta',
      'Почта России',
      false,
      this.pochta.isConfigured(),
      async () => {
        await this.pochta.ping();
        const orderReady = this.pochta.isOrderCreationConfigured();
        return {
          status: orderReady ? 'ok' : 'degraded',
          message: orderReady
            ? 'API отвечает'
            : 'Токен есть, но POCHTA_FROM_INDEX не задан',
        };
      },
    );
  }

  private async checkOzonPay(): Promise<HealthCheckItem> {
    return this.runCheck(
      'ozon_pay',
      'Ozon Pay',
      false,
      this.payments.isConfigured(),
      async () => {
        const detail = await this.payments.ping();
        return {
          status: detail.ok ? 'ok' : 'down',
          message: detail.message,
        };
      },
    );
  }

  private async checkMail(): Promise<HealthCheckItem> {
    return this.runCheck(
      'mail',
      'Почта (Resend)',
      false,
      this.mail.isConfigured(),
      async () => ({
        status: 'ok',
        message: 'RESEND_API_KEY и MAIL_FROM заданы',
      }),
    );
  }

  private async checkGoogle(): Promise<HealthCheckItem> {
    return this.runCheck(
      'google_oauth',
      'Google OAuth',
      false,
      this.auth.isGoogleConfigured(),
      async () => ({
        status: 'ok',
        message: 'Клиент Google настроен',
      }),
    );
  }
}
