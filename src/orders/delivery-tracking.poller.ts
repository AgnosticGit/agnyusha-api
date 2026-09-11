import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryMethodCode, OrderStatus } from '@prisma/client';
import { CdekService } from '../cdek/cdek.service';
import { PochtaService } from '../pochta/pochta.service';
import { PrismaService } from '../prisma/prisma.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { FINAL_DELIVERY_STATUS_CODE_LIST } from './delivery-status.util';
import {
  DEFAULT_POLL_GAP_MS,
  DEFAULT_POLL_INTERVAL_MIN,
  DELIVERY_POLL_CARRIERS,
  DELIVERY_POLL_ENV,
  POLL_TICK_MS,
  type DeliveryPollCarrier,
  type DeliveryPollSnapshot,
  isGapElapsed,
  parsePollGapMs,
  parsePollIntervalMin,
} from './delivery-poll.util';
import { OrdersService } from './orders.service';

type CarrierRuntime = {
  lastRequestAtMs: number | null;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  busy: boolean;
};

@Injectable()
export class DeliveryTrackingPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryTrackingPoller.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly runtime: Record<DeliveryPollCarrier, CarrierRuntime> = {
    CDEK: this.emptyRuntime(),
    YANDEX: this.emptyRuntime(),
    POST: this.emptyRuntime(),
  };

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly cdek: CdekService,
    private readonly yandex: YandexDeliveryService,
    private readonly pochta: PochtaService,
  ) {}

  onModuleInit() {
    if (!this.shouldStartLoop()) return;
    this.timer = setInterval(() => {
      void this.tickAll();
    }, POLL_TICK_MS);
    this.logger.log(
      `Delivery poller started ` +
        DELIVERY_POLL_CARRIERS.map((code) => {
          const intervalMin = this.intervalMin(code);
          const gapMs = this.gapMs(code);
          return `${code} interval=${intervalMin}m gap=${gapMs}ms`;
        }).join('; '),
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tickAll() {
    await Promise.all(
      DELIVERY_POLL_CARRIERS.map((code) => this.tickCarrier(code)),
    );
  }

  async tickCarrier(code: DeliveryPollCarrier, nowMs = Date.now()) {
    const state = this.runtime[code];
    if (state.busy) return;
    if (!this.isCarrierEnabled(code)) return;
    if (this.intervalMin(code) <= 0) return;
    if (!isGapElapsed(state.lastRequestAtMs, this.gapMs(code), nowMs)) return;

    state.busy = true;
    try {
      const due = await this.findDueOrder(code, nowMs);
      if (!due) return;

      state.lastRequestAtMs = nowMs;
      state.lastAttemptAt = new Date(nowMs);
      await this.orders.syncDeliveryTracking(due);
      state.lastSuccessAt = new Date();
      state.lastError = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.lastError = message.slice(0, 180);
      this.logger.warn(`Delivery poll ${code} failed: ${message}`);
    } finally {
      state.busy = false;
    }
  }

  async snapshot(code: DeliveryPollCarrier): Promise<DeliveryPollSnapshot> {
    const intervalMin = this.intervalMin(code);
    const gapMs = this.gapMs(code);
    const state = this.runtime[code];
    const enabled = this.isCarrierEnabled(code) && intervalMin > 0;
    const activeCount = enabled ? await this.countActive(code) : 0;
    return {
      carrier: code,
      enabled,
      intervalMs: intervalMin * 60_000,
      gapMs,
      activeCount,
      lastSuccessAt: state.lastSuccessAt,
      lastAttemptAt: state.lastAttemptAt,
      lastError: state.lastError,
    };
  }

  private shouldStartLoop() {
    if (process.env.JEST_WORKER_ID) return false;
    if (process.env.NODE_ENV === 'test') return false;
    return true;
  }

  private isCarrierEnabled(code: DeliveryPollCarrier) {
    if (code === 'CDEK') return this.cdek.isConfigured();
    if (code === 'YANDEX') return this.yandex.isConfigured();
    return this.pochta.isConfigured();
  }

  private intervalMin(code: DeliveryPollCarrier) {
    const key = DELIVERY_POLL_ENV[code].interval;
    return parsePollIntervalMin(
      this.config.get<string>(key),
      DEFAULT_POLL_INTERVAL_MIN,
    );
  }

  private gapMs(code: DeliveryPollCarrier) {
    const key = DELIVERY_POLL_ENV[code].gap;
    return parsePollGapMs(this.config.get<string>(key), DEFAULT_POLL_GAP_MS);
  }

  private emptyRuntime(): CarrierRuntime {
    return {
      lastRequestAtMs: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      busy: false,
    };
  }

  private deliveryCode(code: DeliveryPollCarrier): DeliveryMethodCode {
    if (code === 'CDEK') return DeliveryMethodCode.CDEK;
    if (code === 'YANDEX') return DeliveryMethodCode.YANDEX;
    return DeliveryMethodCode.POST;
  }

  private activeWhere(code: DeliveryPollCarrier) {
    return {
      deliveryCode: this.deliveryCode(code),
      externalDeliveryId: { not: null },
      status: { not: OrderStatus.ARCHIVED },
      OR: [
        { deliveryStatusCode: null },
        { deliveryStatusCode: { notIn: FINAL_DELIVERY_STATUS_CODE_LIST } },
      ],
    };
  }

  private async countActive(code: DeliveryPollCarrier) {
    return this.prisma.order.count({ where: this.activeWhere(code) });
  }

  private async findDueOrder(code: DeliveryPollCarrier, nowMs: number) {
    const cutoff = new Date(nowMs - this.intervalMin(code) * 60_000);
    const active = this.activeWhere(code);
    return this.prisma.order.findFirst({
      where: {
        deliveryCode: active.deliveryCode,
        externalDeliveryId: active.externalDeliveryId,
        status: active.status,
        AND: [
          { OR: active.OR },
          {
            OR: [
              { deliveryStatusAt: null },
              { deliveryStatusAt: { lte: cutoff } },
            ],
          },
        ],
      },
      orderBy: { deliveryStatusAt: { sort: 'asc', nulls: 'first' } },
    });
  }
}
