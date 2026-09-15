import {
  parseLabelTxt,
  formatPackWeightLabel,
  defaultPackageDims,
} from '../../src/products/label-txt.parser';

describe('parseLabelTxt', () => {
  const sample = `
# .АГНЮША.
## Премиальное Качество

# ПОЛНОРАЦИОННЫЙ СУХОЙ КОРМ ДЛЯ СОБАК ВСЕХ ПОРОД

## ИНГРЕДИЕНТЫ ЖИВОТНОГО ПРОИСХОЖДЕНИЯ - 55 %

### ИНГРЕДИЕНТЫ
Мясные ингредиенты 55% (свежее мясо индейки 27%) рис.

### Основные добавки
Калий, медь.

### Анализ состава
Сырой протеин — 27,00%
Жир — 15%

### Жирные кислоты
Омега 6 — 2,2%

### Пищевые добавки на кг

#### Витамины
Витамин А — 15000 МЕ

#### Минералы
Цинк — 110 мг

### Энергетическая ценность
385 ккал / 100 г

## БЕНЕФИТЫ ЗДОРОВЬЕ
— Высокое содержание белка.
— HUMAN GRADE.

### Срок годности
12 месяцев

### Условия хранения
Хранить в сухом месте.

### Рекомендация по приему
75%/25% → 100%.

### Суточная норма кормления
Вес | Низкая | Обычная
10 кг | 154 г | 183 г

## Фасовки
- 800 г — 735 ₽ — высота=28 длина=15 ширина=8
- 2,5 кг — 2125 ₽ — высота=42 длина=24 ширина=11
- 5 кг — 3910 ₽ — высота=41 длина=31 ширина=11
- 12 кг — 8160 ₽
`.trim();

  it('extracts product fields and tab sections', () => {
    const parsed = parseLabelTxt(sample);
    expect(parsed.category).toBe('DOGS');
    expect(parsed.name).toMatch(/индейки/i);
    expect(parsed.nutritionProtein).toBe(27);
    expect(parsed.nutritionFat).toBe(15);
    expect(parsed.variants).toEqual([
      {
        weightLabel: '800 г.',
        weightGrams: 800,
        price: 735,
        stock: 50,
        lengthCm: 15,
        widthCm: 8,
        heightCm: 28,
      },
      {
        weightLabel: '2,5 кг.',
        weightGrams: 2500,
        price: 2125,
        stock: 50,
        lengthCm: 24,
        widthCm: 11,
        heightCm: 42,
      },
      {
        weightLabel: '5 кг.',
        weightGrams: 5000,
        price: 3910,
        stock: 50,
        lengthCm: 31,
        widthCm: 11,
        heightCm: 41,
      },
      {
        weightLabel: '12 кг.',
        weightGrams: 12000,
        price: 8160,
        stock: 50,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      },
    ]);
    expect(parsed.weightGrams).toBe(800);
    expect(parsed.weightLabel).toMatch(/800/);

    const titles = parsed.sections.map((s) => s.title);
    expect(titles).toEqual(['Состав', 'Польза', 'Хранение', 'Кормление']);
    expect(parsed.sections[0].body).toContain('индейки');
    expect(parsed.sections[0].body).toContain('Сырой протеин');
    expect(parsed.sections[0].body).toContain('Витамин');
    expect(parsed.sections[3].body).toContain('<table>');
  });

  it('marks sold-out packs from фасовки block and keeps prices', () => {
    const parsed = parseLabelTxt(`
# ПОЛНОРАЦИОННЫЙ СУХОЙ КОРМ ДЛЯ СОБАК ВСЕХ ПОРОД
ягнёнок

## Фасовки
Товар закончился
- 800 г — 780 ₽
- 2,5 кг — 2250 ₽
`.trim());
    expect(parsed.variants).toHaveLength(2);
    expect(parsed.variants.every((v) => v.stock === 0)).toBe(true);
    expect(parsed.variants.map((v) => [v.weightGrams, v.price])).toEqual([
      [800, 780],
      [2500, 2250],
    ]);
  });

  it('marks a single pack as sold out from line marker', () => {
    const parsed = parseLabelTxt(`
# ПОЛНОРАЦИОННЫЙ СУХОЙ КОРМ ДЛЯ ВЗРОСЛЫХ КОШЕК
рыба

## Фасовки
- 250 г — 400 ₽ — высота=15 длина=11 ширина=7
- 800 г — 980 ₽ — закончился — высота=28 длина=15 ширина=8
- 2,5 кг — 2750 ₽ — высота=42 длина=24 ширина=11
`.trim());
    expect(parsed.variants.map((v) => [v.weightGrams, v.price, v.stock])).toEqual([
      [250, 400, 50],
      [800, 980, 0],
      [2500, 2750, 50],
    ]);
    expect(parsed.variants[0]).toMatchObject({
      lengthCm: 11,
      widthCm: 7,
      heightCm: 15,
    });
  });

  it('parses kitten packs 250/700/2.5kg with dims', () => {
    const parsed = parseLabelTxt(`
# СУХОЙ ПОЛНОРАЦИОННЫЙ КОРМ ДЛЯ КОТЯТ

## Фасовки
- 250 г — 430 ₽ — высота=15 длина=11 ширина=7
- 700 г — 980 ₽ — высота=28 длина=15 ширина=8
- 2,5 кг — 2950 ₽ — высота=42 длина=24 ширина=11
`.trim());
    expect(parsed.category).toBe('CATS');
    expect(parsed.name).toMatch(/котят/i);
    expect(parsed.variants.map((v) => v.weightGrams)).toEqual([250, 700, 2500]);
    expect(parsed.variants[1]).toMatchObject({
      weightLabel: '700 г.',
      price: 980,
      lengthCm: 15,
      widthCm: 8,
      heightCm: 28,
    });
  });

  it('defaults cat pack sizes when фасовки missing', () => {
    const parsed = parseLabelTxt(`
# СУХОЙ КОРМ ДЛЯ КОТЯТ

### ИНГРЕДИЕНТЫ
курица
`.trim());
    expect(parsed.category).toBe('CATS');
    expect(parsed.variants.map((v) => v.weightGrams)).toEqual([
      250, 700, 2500,
    ]);
    expect(parsed.variants[0]).toMatchObject(defaultPackageDims(250));
    expect(parsed.variants[1]).toMatchObject(defaultPackageDims(700));
  });

  it('formatPackWeightLabel formats grams and kg', () => {
    expect(formatPackWeightLabel(250)).toBe('250 г.');
    expect(formatPackWeightLabel(700)).toBe('700 г.');
    expect(formatPackWeightLabel(800)).toBe('800 г.');
    expect(formatPackWeightLabel(2500)).toBe('2,5 кг.');
    expect(formatPackWeightLabel(5000)).toBe('5 кг.');
    expect(formatPackWeightLabel(0)).toBe('800 г.');
  });

  it('defaultPackageDims maps known pack sizes', () => {
    expect(defaultPackageDims(250)).toEqual({
      lengthCm: 11,
      widthCm: 7,
      heightCm: 15,
    });
    expect(defaultPackageDims(700)).toEqual({
      lengthCm: 15,
      widthCm: 8,
      heightCm: 28,
    });
    expect(defaultPackageDims(800)).toEqual({
      lengthCm: 15,
      widthCm: 8,
      heightCm: 28,
    });
    expect(defaultPackageDims(2500)).toEqual({
      lengthCm: 24,
      widthCm: 11,
      heightCm: 42,
    });
    expect(defaultPackageDims(5000)).toEqual({
      lengthCm: 31,
      widthCm: 11,
      heightCm: 41,
    });
  });

  it('detects cats and kitten titles', () => {
    const cats = parseLabelTxt(`
# ПОЛНОРАЦИОННЫЙ СУХОЙ КОРМ ДЛЯ ВЗРОСЛЫХ КОШЕК
подходит для стерилизованных кошек

### ИНГРЕДИЕНТЫ
Свежая белая рыба 23%.

### Вес упаковки
2,5 кг
`);
    expect(cats.category).toBe('CATS');
    expect(cats.name).toMatch(/кошек/i);
    expect(cats.subtitle).toBe('Подходит для стерилизованных кошек');
    expect(cats.weightGrams).toBe(2500);
    expect(cats.variants[0]).toMatchObject({
      lengthCm: 24,
      widthCm: 11,
      heightCm: 42,
    });
  });
});
