import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdatePickupSettingsDto } from './dto/pickup.dto';
import {
  DEFAULT_PICKUP_SETTINGS,
  generatePickupSlots,
  isValidPickupSlot,
  normalizePickupSettings,
  scheduleSummary,
  type PickupSettingsShape,
} from './pickup.util';

@Injectable()
export class PickupService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(): Promise<PickupSettingsShape> {
    const row = await this.prisma.pickupSettings.findUnique({
      where: { id: 'default' },
    });
    if (!row) {
      return this.ensureDefaults();
    }
    return normalizePickupSettings({
      address: row.address,
      minLeadDays: row.minLeadDays,
      schedule: row.schedule,
    });
  }

  async ensureDefaults(): Promise<PickupSettingsShape> {
    const created = await this.prisma.pickupSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        address: DEFAULT_PICKUP_SETTINGS.address,
        minLeadDays: DEFAULT_PICKUP_SETTINGS.minLeadDays,
        schedule: DEFAULT_PICKUP_SETTINGS.schedule as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
    return normalizePickupSettings({
      address: created.address,
      minLeadDays: created.minLeadDays,
      schedule: created.schedule,
    });
  }

  async updateSettings(
    dto: UpdatePickupSettingsDto,
  ): Promise<PickupSettingsShape> {
    for (const day of dto.schedule) {
      const [sh, sm] = day.startTime.split(':').map(Number);
      const [eh, em] = day.endTime.split(':').map(Number);
      if (eh * 60 + em <= sh * 60 + sm) {
        throw new BadRequestException(
          'Время окончания должно быть позже начала',
        );
      }
    }
    if (dto.schedule.length !== 7) {
      throw new BadRequestException('Нужен график на все 7 дней недели');
    }
    const weekdays = new Set(dto.schedule.map((d) => d.weekday));
    if (weekdays.size !== 7) {
      throw new BadRequestException('Каждый день недели должен быть указан один раз');
    }

    const normalized = normalizePickupSettings(dto);
    const row = await this.prisma.pickupSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        address: normalized.address,
        minLeadDays: normalized.minLeadDays,
        schedule: normalized.schedule as unknown as Prisma.InputJsonValue,
      },
      update: {
        address: normalized.address,
        minLeadDays: normalized.minLeadDays,
        schedule: normalized.schedule as unknown as Prisma.InputJsonValue,
      },
    });
    return normalizePickupSettings({
      address: row.address,
      minLeadDays: row.minLeadDays,
      schedule: row.schedule,
    });
  }

  async publicView() {
    const settings = await this.getSettings();
    return {
      ...settings,
      scheduleSummary: scheduleSummary(settings.schedule),
      slots: generatePickupSlots(settings),
    };
  }

  async assertValidSlot(at: Date): Promise<PickupSettingsShape> {
    const settings = await this.getSettings();
    if (!isValidPickupSlot(settings, at)) {
      throw new BadRequestException(
        'Выберите доступную дату и время самовывоза',
      );
    }
    return settings;
  }
}
