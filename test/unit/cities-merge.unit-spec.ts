import { mergeUnifiedCities } from '../../src/cities/cities-merge';

describe('mergeUnifiedCities', () => {
  it('keeps separate CDEK and Yandex rows when labels differ', () => {
    const rows = mergeUnifiedCities(
      [
        {
          code: 44,
          name: 'Москва',
          region: 'Москва',
          label: 'Москва',
        },
      ],
      [
        {
          geoId: 213,
          name: 'Казань',
          region: 'Татарстан',
          label: 'Казань',
        },
      ],
      12,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('cdek:44');
    expect(rows[1].id).toBe('yandex:213');
  });

  it('merges same label into both: id', () => {
    const rows = mergeUnifiedCities(
      [
        {
          code: 137,
          name: 'Санкт-Петербург',
          region: 'Санкт-Петербург',
          label: 'Санкт-Петербург',
        },
      ],
      [
        {
          geoId: 2,
          name: 'Санкт-Петербург',
          region: 'Санкт-Петербург',
          label: 'Санкт-Петербург',
        },
      ],
      12,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('both:137:2');
    expect(rows[0].cdekCode).toBe(137);
    expect(rows[0].yandexGeoId).toBe(2);
  });

  it('respects limit after merge', () => {
    const rows = mergeUnifiedCities(
      [
        { code: 1, name: 'A', region: 'R', label: 'A' },
        { code: 2, name: 'B', region: 'R', label: 'B' },
      ],
      [{ geoId: 9, name: 'C', region: 'R', label: 'C' }],
      2,
    );
    expect(rows).toHaveLength(2);
  });
});
