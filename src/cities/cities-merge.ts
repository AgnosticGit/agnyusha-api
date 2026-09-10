export type UnifiedCity = {
  id: string;
  name: string;
  region: string;
  label: string;
  cdekCode: number | null;
  yandexGeoId: number | null;
};

export type CdekCityInput = {
  code: number;
  name: string;
  region: string;
  label: string;
};

export type YandexCityInput = {
  geoId: number;
  name: string;
  region: string;
  label: string;
};

function normalizeKey(label: string) {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Merge CDEK + Yandex city suggestions into a de-duplicated list. */
export function mergeUnifiedCities(
  cdekCities: CdekCityInput[],
  yandexCities: YandexCityInput[],
  limit: number,
): UnifiedCity[] {
  const byKey = new Map<string, UnifiedCity>();
  const byCdekCode = new Map<number, UnifiedCity>();
  const byYandexGeoId = new Map<number, UnifiedCity>();

  for (const city of cdekCities) {
    const existingByCode = byCdekCode.get(city.code);
    if (existingByCode) continue;

    const key = normalizeKey(city.label || city.name);
    const existing = byKey.get(key);
    if (existing) {
      existing.cdekCode = city.code;
      byCdekCode.set(city.code, existing);
      continue;
    }
    const row: UnifiedCity = {
      id: `cdek:${city.code}`,
      name: city.name,
      region: city.region,
      label: city.label,
      cdekCode: city.code,
      yandexGeoId: null,
    };
    byKey.set(key, row);
    byCdekCode.set(city.code, row);
  }

  for (const city of yandexCities) {
    const existingByGeo = byYandexGeoId.get(city.geoId);
    if (existingByGeo) continue;

    const key = normalizeKey(city.label || city.name);
    const existing = byKey.get(key);
    if (existing) {
      existing.yandexGeoId = city.geoId;
      if (!existing.id.startsWith('both:')) {
        existing.id = `both:${existing.cdekCode ?? 'x'}:${city.geoId}`;
      }
      byYandexGeoId.set(city.geoId, existing);
      continue;
    }
    const row: UnifiedCity = {
      id: `yandex:${city.geoId}`,
      name: city.name,
      region: city.region,
      label: city.label,
      cdekCode: null,
      yandexGeoId: city.geoId,
    };
    byKey.set(key, row);
    byYandexGeoId.set(city.geoId, row);
  }

  return Array.from(byKey.values()).slice(0, limit);
}
