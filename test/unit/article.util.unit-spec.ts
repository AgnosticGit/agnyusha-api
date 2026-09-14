import {
  extractTocFromHtml,
  isAllowedEmbedSrc,
  prepareArticleContent,
  sanitizeArticleHtml,
  slugifyTitle,
} from '../../src/articles/article.util';

describe('slugifyTitle', () => {
  it('transliterates Cyrillic titles', () => {
    expect(slugifyTitle('Полезные советы')).toMatch(/poleznye-sovety/);
  });
});

describe('extractTocFromHtml', () => {
  it('extracts h2/h3 with existing ids', () => {
    const html =
      '<h2 id="intro">Введение</h2><p>x</p><h3 id="part-1">Часть 1</h3>';
    const { toc, html: out } = extractTocFromHtml(html);
    expect(toc).toEqual([
      { id: 'intro', text: 'Введение', level: 2 },
      { id: 'part-1', text: 'Часть 1', level: 3 },
    ]);
    expect(out).toContain('id="intro"');
    expect(out).toContain('id="part-1"');
  });

  it('assigns missing ids from heading text', () => {
    const { toc, html } = extractTocFromHtml('<h2>Корм для собак</h2>');
    expect(toc).toHaveLength(1);
    expect(toc[0].level).toBe(2);
    expect(toc[0].text).toBe('Корм для собак');
    expect(toc[0].id).toMatch(/korm/);
    expect(html).toContain(`id="${toc[0].id}"`);
  });

  it('deduplicates generated ids', () => {
    const { toc } = extractTocFromHtml('<h2>Same</h2><h2>Same</h2>');
    expect(toc[0].id).not.toBe(toc[1].id);
  });
});

describe('sanitizeArticleHtml embed allowlist', () => {
  it('keeps youtube and vimeo iframes', () => {
    const yt =
      '<p>v</p><iframe src="https://www.youtube.com/embed/abc123" title="yt"></iframe>';
    const vim =
      '<iframe src="https://player.vimeo.com/video/123" allowfullscreen></iframe>';
    expect(sanitizeArticleHtml(yt)).toContain('youtube.com/embed/abc123');
    expect(sanitizeArticleHtml(vim)).toContain('player.vimeo.com/video/123');
  });

  it('strips non-allowlisted iframes', () => {
    const evil =
      '<p>ok</p><iframe src="https://evil.example/embed"></iframe><script>alert(1)</script>';
    const out = sanitizeArticleHtml(evil);
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('script');
    expect(out).toContain('<p>ok</p>');
  });

  it('allows safe images and links; drops javascript href', () => {
    const html =
      '<p><a href="javascript:alert(1)">x</a><a href="https://agnyusha.ru">site</a></p><img src="/uploads/a.png" alt="a" />';
    const out = sanitizeArticleHtml(html);
    expect(out).not.toContain('javascript:');
    expect(out).toContain('https://agnyusha.ru');
    expect(out).toContain('/uploads/a.png');
  });

  it('isAllowedEmbedSrc matches youtube/vimeo only', () => {
    expect(isAllowedEmbedSrc('https://www.youtube.com/embed/x')).toBe(true);
    expect(isAllowedEmbedSrc('https://youtu.be/x')).toBe(true);
    expect(isAllowedEmbedSrc('https://player.vimeo.com/video/1')).toBe(true);
    expect(isAllowedEmbedSrc('https://evil.test/embed')).toBe(false);
  });

  it('prepareArticleContent sanitizes and builds toc', () => {
    const { contentHtml, toc } = prepareArticleContent(
      '<h2>Hello</h2><iframe src="https://www.youtube.com/embed/z"></iframe><iframe src="https://bad.test"></iframe>',
    );
    expect(toc[0].text).toBe('Hello');
    expect(contentHtml).toContain('youtube.com');
    expect(contentHtml).not.toContain('bad.test');
  });
});
