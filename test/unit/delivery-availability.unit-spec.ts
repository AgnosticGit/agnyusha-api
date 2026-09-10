import { DeliveryMethodCode } from '@prisma/client';
import {
  isLocalArea,
  isMoscowArea,
  mapDeliveryAvailability,
} from '../../src/delivery/delivery-availability';

describe('delivery-availability', () => {
  it('detects Spb/LO and Moscow areas', () => {
    expect(isLocalArea('Ленинградская область')).toBe(true);
    expect(isLocalArea('г Санкт-Петербург')).toBe(true);
    expect(isLocalArea('Москва')).toBe(false);
    expect(isMoscowArea('Москва')).toBe(true);
    expect(isMoscowArea('Московская область', 'Химки')).toBe(true);
    expect(isMoscowArea('Казань')).toBe(false);
  });

  const methods = [
    {
      id: '1',
      code: DeliveryMethodCode.PICKUP,
      title: 'Самовывоз',
      description: '',
    },
    {
      id: '2',
      code: DeliveryMethodCode.CDEK,
      title: 'СДЭК',
      description: '',
    },
    {
      id: '3',
      code: DeliveryMethodCode.YANDEX,
      title: 'Яндекс',
      description: '',
    },
    {
      id: '4',
      code: DeliveryMethodCode.POST,
      title: 'Почта',
      description: '',
    },
    {
      id: '5',
      code: DeliveryMethodCode.OZON,
      title: 'Ozon',
      description: '',
    },
  ];

  it('marks all unavailable without location', () => {
    const rows = mapDeliveryAvailability(methods, {
      cdekReady: true,
      pochtaReady: true,
      ozonReady: true,
      yandexOrderReady: true,
      yandexMoscowOnly: false,
    });
    expect(rows.every((r) => r.available === false)).toBe(true);
  });

  it('enables pickup only for Spb/LO', () => {
    const local = mapDeliveryAvailability(methods, {
      region: 'Санкт-Петербург',
      label: 'СПб',
      cdekReady: true,
      pochtaReady: true,
      ozonReady: true,
      yandexOrderReady: true,
      yandexMoscowOnly: false,
    });
    expect(local.find((m) => m.code === 'PICKUP')?.available).toBe(true);
    expect(local.find((m) => m.code === 'OZON')?.available).toBe(true);

    const remote = mapDeliveryAvailability(methods, {
      region: 'Казань',
      label: 'Казань',
      cdekReady: true,
      pochtaReady: true,
      ozonReady: false,
      yandexOrderReady: true,
      yandexMoscowOnly: false,
    });
    expect(remote.find((m) => m.code === 'PICKUP')?.available).toBe(false);
    expect(remote.find((m) => m.code === 'OZON')?.available).toBe(false);
  });

  it('limits Yandex to Moscow in test contour', () => {
    const moscow = mapDeliveryAvailability(methods, {
      region: 'Москва',
      label: 'Москва',
      cdekReady: true,
      pochtaReady: false,
      ozonReady: false,
      yandexOrderReady: true,
      yandexMoscowOnly: true,
    });
    expect(moscow.find((m) => m.code === 'YANDEX')?.available).toBe(true);
    expect(moscow.find((m) => m.code === 'POST')?.available).toBe(false);

    const spb = mapDeliveryAvailability(methods, {
      region: 'Санкт-Петербург',
      label: 'СПб',
      cdekReady: true,
      pochtaReady: true,
      ozonReady: true,
      yandexOrderReady: true,
      yandexMoscowOnly: true,
    });
    expect(spb.find((m) => m.code === 'YANDEX')?.available).toBe(false);
  });
});
