import { sanitizeProductHtml } from '../../src/products/sanitize-description';

describe('sanitizeProductHtml', () => {
  it('wraps plain text in a paragraph and escapes HTML entities', () => {
    expect(sanitizeProductHtml('hello')).toBe('<p>hello</p>');
    expect(sanitizeProductHtml('a < b')).toBe('<p>a &lt; b</p>');
  });

  it('returns empty for blank input', () => {
    expect(sanitizeProductHtml('')).toBe('');
    expect(sanitizeProductHtml('   ')).toBe('');
    expect(sanitizeProductHtml(null)).toBe('');
  });

  it('strips XSS script/style tags while keeping safe markup', () => {
    expect(
      sanitizeProductHtml(
        '<p>ok <strong>x</strong></p><script>alert(1)</script>',
      ),
    ).toBe('<p>ok <strong>x</strong></p>');
    expect(
      sanitizeProductHtml('<p>hi</p><style>body{display:none}</style>'),
    ).toBe('<p>hi</p>');
  });

  it('allowlists only safe style properties (font-size)', () => {
    expect(
      sanitizeProductHtml(
        '<span style="font-size: 1.25rem; color: red">x</span>',
      ),
    ).toBe('<span style="font-size: 1.25rem">x</span>');
    expect(
      sanitizeProductHtml('<span style="background: url(x)">x</span>'),
    ).toBe('<span>x</span>');
    expect(sanitizeProductHtml('<p style="font-size: 16px">y</p>')).toBe(
      '<p style="font-size: 16px">y</p>',
    );
  });

  it('strips disallowed tags and attributes', () => {
    expect(
      sanitizeProductHtml('<a href="https://evil.test">link</a><em>ok</em>'),
    ).toBe('link<em>ok</em>');
  });
});
