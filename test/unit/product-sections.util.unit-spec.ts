import { normalizeProductSections } from '../../src/products/product-sections.util';

describe('normalizeProductSections', () => {
  it('returns empty array for non-arrays', () => {
    expect(normalizeProductSections(null)).toEqual([]);
    expect(normalizeProductSections({})).toEqual([]);
    expect(normalizeProductSections('x')).toEqual([]);
  });

  it('drops empty rows and sanitizes body', () => {
    expect(
      normalizeProductSections([
        { title: 'Состав', body: '<p>ok</p><script>x</script>' },
        { title: '  ', body: '  ' },
        null,
        { title: '', body: '<p>Только тело</p>' },
      ]),
    ).toEqual([
      { title: 'Состав', body: '<p>ok</p>' },
      { title: 'Раздел', body: '<p>Только тело</p>' },
    ]);
  });

  it('truncates long titles', () => {
    const title = 'А'.repeat(200);
    const [row] = normalizeProductSections([{ title, body: '<p>x</p>' }]);
    expect(row.title).toHaveLength(120);
  });
});
