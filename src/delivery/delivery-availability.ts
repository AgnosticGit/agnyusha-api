import type { DeliveryMethodCode } from '@prisma/client';

export function isLocalArea(...parts: Array<string | undefined>) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  return (
    text.includes('санкт-петербург') ||
    text.includes('ленинградская') ||
    text.includes('петербург')
  );
}

export function isMoscowArea(...parts: Array<string | undefined>) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  return text.includes('москва') || text.includes('московская');
}

export type DeliveryMethodRow = {
  id: string;
  code: DeliveryMethodCode;
  title: string;
  description: string;
};

export type DeliveryAvailability = DeliveryMethodRow & {
  available: boolean;
  note?: string;
};

/** Shown in checkout but not selectable until re-enabled. */
const BLOCKED_DELIVERY_CODES = new Set<DeliveryMethodCode>([
  'PICKUP',
  'OZON',
]);

/** Pure location → availability mapping (unit-tested). */
export function mapDeliveryAvailability(
  methods: DeliveryMethodRow[],
  input: {
    region?: string;
    label?: string;
    cdekReady: boolean;
    pochtaReady: boolean;
    ozonReady: boolean;
    yandexOrderReady: boolean;
    yandexMoscowOnly: boolean;
  },
): DeliveryAvailability[] {
  const { region, label } = input;
  if (!region && !label) {
    return sortDeliveryMethods(
      methods.map((m) => ({ ...m, available: false })),
    );
  }

  const mapped = methods.map((m) => {
    if (BLOCKED_DELIVERY_CODES.has(m.code)) {
      return {
        ...m,
        available: false,
        note:
          m.code === 'PICKUP'
            ? 'Самовывоз временно недоступен'
            : 'Ozon Доставка временно недоступна',
      };
    }
    if (m.code === 'CDEK') {
      return {
        ...m,
        available: input.cdekReady,
        note: input.cdekReady
          ? 'Выберите пункт выдачи СДЭК'
          : 'СДЭК временно недоступен',
      };
    }
    if (m.code === 'YANDEX') {
      const available =
        input.yandexOrderReady &&
        (!input.yandexMoscowOnly || isMoscowArea(region, label));
      return {
        ...m,
        available,
        note: !input.yandexOrderReady
          ? 'Яндекс Доставка временно недоступна'
          : input.yandexMoscowOnly && !isMoscowArea(region, label)
            ? 'В тестовой среде Яндекс доступен только для Москвы'
            : 'Выберите пункт выдачи Яндекс Доставки',
      };
    }
    if (m.code === 'POST') {
      return {
        ...m,
        available: input.pochtaReady,
        note: input.pochtaReady
          ? 'Выберите отделение Почты России'
          : 'Почта России временно недоступна',
      };
    }
    return {
      ...m,
      available: true,
      note: 'Доставка по всей России',
    };
  });

  return sortDeliveryMethods(mapped);
}

/** Keep blocked methods at the end; preserve relative order otherwise. */
function sortDeliveryMethods(
  methods: DeliveryAvailability[],
): DeliveryAvailability[] {
  return [...methods].sort((a, b) => {
    const aBlocked = BLOCKED_DELIVERY_CODES.has(a.code) ? 1 : 0;
    const bBlocked = BLOCKED_DELIVERY_CODES.has(b.code) ? 1 : 0;
    return aBlocked - bBlocked;
  });
}
