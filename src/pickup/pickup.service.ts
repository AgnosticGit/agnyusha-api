import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdatePickupSettingsDto } from './dto/pickup.dto';
import {
  DEFAULT_PICKUP_SETTINGS,
  findPickupLocation,
  formatPickupLocationAddress,
  generatePickupSlots,
  isPickupAllowedForLocation,
  isValidPickupSlot,
  normalizePickupSettings,
  scheduleSummary,
  type PickupLocation,
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
      phones: row.phones,
      locations: row.locations,
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
        phones: DEFAULT_PICKUP_SETTINGS.phones,
        locations:
          DEFAULT_PICKUP_SETTINGS.locations as unknown as Prisma.InputJsonValue,
        schedule:
          DEFAULT_PICKUP_SETTINGS.schedule as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
    return normalizePickupSettings({
      address: created.address,
      minLeadDays: created.minLeadDays,
      phones: created.phones,
      locations: created.locations,
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
      throw new BadRequestException(
        'Каждый день недели должен быть указан один раз',
      );
    }

    const normalized = normalizePickupSettings(dto);
    if (!normalized.phones.length) {
      throw new BadRequestException(
        'Укажите хотя бы один телефон для самовывоза',
      );
    }
    if (!normalized.locations.length) {
      throw new BadRequestException(
        'Укажите хотя бы один город и адрес самовывоза',
      );
    }
    const row = await this.prisma.pickupSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        address: normalized.address,
        minLeadDays: normalized.minLeadDays,
        phones: normalized.phones,
        locations: normalized.locations as unknown as Prisma.InputJsonValue,
        schedule: normalized.schedule as unknown as Prisma.InputJsonValue,
      },
      update: {
        address: normalized.address,
        minLeadDays: normalized.minLeadDays,
        phones: normalized.phones,
        locations: normalized.locations as unknown as Prisma.InputJsonValue,
        schedule: normalized.schedule as unknown as Prisma.InputJsonValue,
      },
    });
    return normalizePickupSettings({
      address: row.address,
      minLeadDays: row.minLeadDays,
      phones: row.phones,
      locations: row.locations,
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

  async resolveLocationForCity(input: {
    cityLabel: string;
    region?: string;
    settlement?: string;
  }): Promise<{ settings: PickupSettingsShape; location: PickupLocation }> {
    const settings = await this.getSettings();
    const location = findPickupLocation(settings.locations, {
      label: input.cityLabel,
      region: input.region,
      settlement: input.settlement,
    });
    if (!location) {
      throw new BadRequestException(
        'Самовывоз недоступен для выбранного города',
      );
    }
    return { settings, location };
  }

  displayAddress(location: PickupLocation): string {
    return formatPickupLocationAddress(location);
  }

  isAllowedForCity(input: {
    cityLabel?: string;
    region?: string;
    settlement?: string;
  }): Promise<boolean> {
    return this.getSettings().then((settings) =>
      isPickupAllowedForLocation(settings.locations, {
        label: input.cityLabel,
        region: input.region,
        settlement: input.settlement,
      }),
    );
  }
}
