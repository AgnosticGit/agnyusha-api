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

/** Pure location → availability mapping (unit-tested). */
export function mapDeliveryAvailability(
  methods: DeliveryMethodRow[],
  input: {
    region?: string;
    label?: string;
    cdekReady: boolean;
    pochtaReady: boolean;
    yandexOrderReady: boolean;
    yandexMoscowOnly: boolean;
  },
): DeliveryAvailability[] {
  const { region, label } = input;
  if (!region && !label) {
    return methods.map((m) => ({ ...m, available: false }));
  }

  const local = isLocalArea(region, label);
  return methods.map((m) => {
    if (m.code === 'PICKUP') {
      return {
        ...m,
        available: local,
        note: local
          ? 'Самовывоз из пункта в Ленинградской области'
          : 'Самовывоз доступен только для СПб и ЛО',
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
}
