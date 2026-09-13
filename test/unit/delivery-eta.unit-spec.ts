import {
  applyEtaToMethod,
  calendarDaysFromNow,
  dayWord,
  etaFromDayRange,
  etaFromIsoInterval,
  formatEtaDays,
  pickEtaForCode,
} from '../../src/delivery/delivery-eta';
import type { DeliveryAvailability } from '../../src/delivery/delivery-availability';

describe('delivery-eta', () => {
  it('pluralizes день correctly', () => {
    expect(dayWord(1)).toBe('день');
    expect(dayWord(2)).toBe('дня');
    expect(dayWord(5)).toBe('дней');
    expect(dayWord(11)).toBe('дней');
    expect(dayWord(21)).toBe('день');
    expect(dayWord(22)).toBe('дня');
  });

  it('formats day ranges', () => {
    expect(formatEtaDays(1, 1)).toBe('1 день');
    expect(formatEtaDays(2, 2)).toBe('2 дня');
    expect(formatEtaDays(3, 5)).toBe('3–5 дней');
    expect(formatEtaDays(5, 3)).toBe('5 дней');
  });

  it('builds eta from day range', () => {
    expect(etaFromDayRange(2, 4)).toEqual({
      minDays: 2,
      maxDays: 4,
      text: '2–4 дня',
    });
    expect(etaFromDayRange(undefined, 3)).toBeNull();
  });

  it('converts ISO intervals to calendar days', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    expect(calendarDaysFromNow('2026-09-13T18:00:00.000Z', now)).toBe(0);
    expect(calendarDaysFromNow('2026-09-16T07:00:00.000Z', now)).toBe(3);
    expect(
      etaFromIsoInterval(
        '2026-09-15T07:00:00.000Z',
        '2026-09-17T07:00:00.000Z',
        now,
      ),
    ).toEqual({ minDays: 2, maxDays: 4, text: '2–4 дня' });
  });

  it('applies eta to available methods only', () => {
    const base: DeliveryAvailability = {
      id: '1',
      code: 'CDEK',
      title: 'СДЭК',
      description: '',
      available: true,
      note: 'Выберите пункт выдачи СДЭК',
    };
    const withEta = applyEtaToMethod(base, {
      minDays: 3,
      maxDays: 5,
      text: '3–5 дней',
    });
    expect(withEta.etaText).toBe('3–5 дней');
    expect(withEta.note).toBe('3–5 дней · Выберите пункт выдачи СДЭК');

    const unavailable = applyEtaToMethod(
      { ...base, available: false, note: 'СДЭК временно недоступен' },
      { minDays: 3, maxDays: 5, text: '3–5 дней' },
    );
    expect(unavailable.etaText).toBeNull();
    expect(unavailable.note).toBe('СДЭК временно недоступен');
  });

  it('picks eta by carrier code', () => {
    const etas = {
      cdek: { minDays: 1, maxDays: 2, text: '1–2 дня' },
      yandex: { minDays: 2, maxDays: 3, text: '2–3 дня' },
      pochta: { minDays: 4, maxDays: 6, text: '4–6 дней' },
    };
    expect(pickEtaForCode('CDEK', etas)?.text).toBe('1–2 дня');
    expect(pickEtaForCode('YANDEX', etas)?.text).toBe('2–3 дня');
    expect(pickEtaForCode('POST', etas)?.text).toBe('4–6 дней');
    expect(pickEtaForCode('PICKUP', etas)).toBeNull();
  });
});
