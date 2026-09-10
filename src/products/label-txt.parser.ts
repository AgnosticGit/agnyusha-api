import { ProductCategory } from '@prisma/client';
import type { ProductSection } from './product-sections.util';

export type ParsedLabelVariant = {
  weightLabel: string;
  weightGrams: number;
  price: number;
  /** 0 = sold out / «товар закончился». */
  stock: number;
};

export type ParsedLabelProduct = {
  name: string;
  subtitle: string;
  category: ProductCategory;
  nutritionProtein: number | null;
  nutritionFat: number | null;
  /** @deprecated Prefer `variants[0]`; kept for older call sites/tests. */
  weightLabel: string;
  weightGrams: number;
  variants: ParsedLabelVariant[];
  sections: ProductSection[];
};

type MdBlock = {
  level: number; // 1–4 for headings, 0 for body
  title: string;
  lines: string[];
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseNumberRu(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitBlocks(markdown: string): MdBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let current: MdBlock | null = null;

  const pushCurrent = () => {
    if (!current) return;
    while (current.lines.length && !current.lines[0].trim()) {
      current.lines.shift();
    }
    while (
      current.lines.length &&
      !current.lines[current.lines.length - 1].trim()
    ) {
      current.lines.pop();
    }
    blocks.push(current);
    current = null;
  };

  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      pushCurrent();
      current = {
        level: heading[1].length,
        title: heading[2].trim(),
        lines: [],
      };
      continue;
    }
    if (!current) {
      current = { level: 0, title: '', lines: [] };
    }
    current.lines.push(line);
  }
  pushCurrent();
  return blocks;
}

function linesToHtml(lines: string[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.includes('|') && lines[i + 1]?.includes('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i]
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean);
        if (cells.length) rows.push(cells);
        i += 1;
      }
      if (rows.length) {
        const [header, ...body] = rows;
        parts.push('<table><thead><tr>');
        for (const cell of header) {
          parts.push(`<th>${escapeHtml(cell)}</th>`);
        }
        parts.push('</tr></thead><tbody>');
        for (const row of body) {
          parts.push('<tr>');
          for (const cell of row) {
            parts.push(`<td>${escapeHtml(cell)}</td>`);
          }
          parts.push('</tr>');
        }
        parts.push('</tbody></table>');
      }
      continue;
    }

    if (/^[—\-~•]\s+/.test(line.trim()) || /^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) break;
        const m = /^[—\-~•]\s+(.+)$/.exec(t) || /^[-*]\s+(.+)$/.exec(t);
        if (!m) break;
        items.push(m[1]);
        i += 1;
      }
      parts.push('<ul>');
      for (const item of items) {
        parts.push(`<li>${escapeHtml(item)}</li>`);
      }
      parts.push('</ul>');
      continue;
    }

    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (
        !t ||
        t.includes('|') ||
        /^[—\-~•]\s+/.test(t) ||
        /^[-*]\s+/.test(t)
      ) {
        break;
      }
      para.push(t);
      i += 1;
    }
    parts.push(`<p>${escapeHtml(para.join(' '))}</p>`);
  }
  return parts.join('');
}

function blockHtml(block: MdBlock, asSubheading = false): string {
  const body = linesToHtml(block.lines);
  if (!block.title) return body;
  if (asSubheading) {
    const tag = block.level >= 4 ? 'h3' : 'h3';
    return `<${tag}>${escapeHtml(block.title)}</${tag}>${body}`;
  }
  return body;
}

function collectGroupedHtml(
  blocks: MdBlock[],
  predicate: (b: MdBlock) => boolean,
): string {
  const html: string[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (!predicate(b)) continue;
    html.push(blockHtml(b, true));
    // Nest following #### under a matching ###
    if (b.level === 3) {
      let j = i + 1;
      while (j < blocks.length && blocks[j].level >= 4) {
        html.push(blockHtml(blocks[j], true));
        j += 1;
      }
    }
  }
  return html.join('');
}

function titleMatches(title: string, ...needles: string[]): boolean {
  const t = title.toLowerCase();
  return needles.some((n) => t.includes(n.toLowerCase()));
}

function inferCategory(title: string, body: string): ProductCategory {
  const hay = `${title}\n${body}`.toLowerCase();
  if (
    hay.includes('котят') ||
    hay.includes('кошек') ||
    hay.includes('котов') ||
    hay.includes('кошк')
  ) {
    return ProductCategory.CATS;
  }
  return ProductCategory.DOGS;
}

function inferName(
  productTitle: string,
  category: ProductCategory,
  fullText: string,
): string {
  const t = productTitle.toLowerCase();
  const text = fullText.toLowerCase();

  if (t.includes('котят')) return 'Корм для котят';
  if (t.includes('взрослых кошек') || t.includes('взрослых кош')) {
    return 'Корм для взрослых кошек';
  }

  const meat =
    (text.includes('говядин') && 'говядины') ||
    ((text.includes('ягнён') || text.includes('ягнен')) && 'ягнёнка') ||
    (text.includes('индейк') && 'индейки') ||
    ((text.includes('белой рыбы') || text.includes('белая рыба')) &&
      'рыбы') ||
    (text.includes('рыб') && 'рыбы') ||
    (text.includes('курин') && 'курицы') ||
    null;

  if (category === ProductCategory.CATS) {
    return meat ? `Корм для кошек из ${meat}` : 'Корм для кошек';
  }
  return meat ? `Корм для собак из ${meat}` : 'Корм для собак';
}

function inferSubtitle(blocks: MdBlock[], productTitle: string): string {
  for (const b of blocks) {
    if (b.level !== 1) continue;
    if (b.title.replace(/\./g, '').trim().toUpperCase() === 'АГНЮША') continue;
    for (const line of b.lines) {
      const t = line.trim();
      if (/^подходит/i.test(t)) return t;
    }
  }
  if (/всех пород/i.test(productTitle)) {
    return 'Подходит для всех пород';
  }
  const premium = blocks.find((b) =>
    titleMatches(b.title, 'премиальное качество'),
  );
  if (premium) return 'Премиальное качество';
  return '';
}

function extractNutrition(blocks: MdBlock[]): {
  protein: number | null;
  fat: number | null;
} {
  let protein: number | null = null;
  let fat: number | null = null;
  for (const b of blocks) {
    if (!titleMatches(b.title, 'анализ состава') && b.level !== 0) {
      // still scan body of analysis block
    }
    const hay = [b.title, ...b.lines].join('\n');
    const prot = /сырой\s+протеин[^\d]*([\d.,]+)\s*%/i.exec(hay);
    const fatM = /(?:сырые\s+жиры(?:\s+и\s+масла)?|жир)[^\d]*([\d.,]+)\s*%/i.exec(
      hay,
    );
    if (prot) protein = parseNumberRu(prot[1]);
    if (fatM) fat = parseNumberRu(fatM[1]);
  }
  return { protein, fat };
}

export function formatPackWeightLabel(grams: number): string {
  if (!Number.isFinite(grams) || grams < 1) return '800 г.';
  if (grams < 1000) return `${Math.round(grams)} г.`;
  const kg = grams / 1000;
  const label =
    Number.isInteger(kg) || Math.abs(kg - Math.round(kg)) < 1e-9
      ? String(Math.round(kg))
      : String(Math.round(kg * 10) / 10).replace('.', ',');
  return `${label} кг.`;
}

function parsePackAmountToGrams(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const kg = /^([\d.,]+)\s*кг\.?$/.exec(t);
  if (kg) {
    const n = parseNumberRu(kg[1]);
    return n && n > 0 ? Math.round(n * 1000) : null;
  }
  const g = /^([\d.,]+)\s*г(?:рамм(?:а|ов)?)?\.?$/.exec(t);
  if (g) {
    const n = parseNumberRu(g[1]);
    return n && n > 0 ? Math.round(n) : null;
  }
  return null;
}

function defaultPacksForCategory(category: ProductCategory): ParsedLabelVariant[] {
  const grams =
    category === ProductCategory.CATS
      ? [250, 800, 2500]
      : [800, 2500, 5000, 12000];
  return grams.map((g) => ({
    weightLabel: formatPackWeightLabel(g),
    weightGrams: g,
    price: 1,
    stock: 50,
  }));
}

function extractVariants(
  blocks: MdBlock[],
  category: ProductCategory,
): ParsedLabelVariant[] {
  const packBlock = blocks.find(
    (b) =>
      (b.level === 2 || b.level === 3) &&
      titleMatches(b.title, 'фасовки', 'веса и цены', 'цены', 'вес упаковки'),
  );

  if (packBlock) {
    const sectionSoldOut = packBlock.lines.some((l) =>
      /товар\s+закончил/i.test(l),
    );
    const variants: ParsedLabelVariant[] = [];
    for (const rawLine of packBlock.lines) {
      const line = rawLine.replace(/^[-*•]\s*/, '').trim();
      if (!line || /товар\s+закончил/i.test(line)) continue;

      const soldOut =
        sectionSoldOut ||
        /закончил|нет\s+в\s+наличии|sold\s*out/i.test(line);

      const amountPart = line.split(/[—–\-:]/)[0]?.trim() ?? '';
      const grams = parsePackAmountToGrams(amountPart);
      if (!grams) continue;

      const priceMatch = /([\d.,]+)\s*₽/.exec(line);
      const price = priceMatch ? (parseNumberRu(priceMatch[1]) ?? 0) : 0;

      variants.push({
        weightLabel: formatPackWeightLabel(grams),
        weightGrams: grams,
        price: Math.max(0, price),
        stock: soldOut ? 0 : 50,
      });
    }
    if (variants.length) return variants;
  }

  // Legacy single «вес упаковки» → one variant
  for (const b of blocks) {
    if (!titleMatches(b.title, 'вес упаковки')) continue;
    const fromTitle = /([\d.,]+)\s*кг/i.exec(b.title);
    const fromBody = b.lines
      .map((l) => /([\d.,]+)\s*кг/i.exec(l))
      .find(Boolean);
    const m = fromTitle || fromBody;
    if (m) {
      const kg = parseNumberRu(m[1]);
      if (kg && kg > 0) {
        const grams = Math.round(kg * 1000);
        return [
          {
            weightLabel: formatPackWeightLabel(grams),
            weightGrams: grams,
            price: 1,
            stock: 50,
          },
        ];
      }
    }
  }

  return defaultPacksForCategory(category);
}

/**
 * Parse packaging label markdown (1b.txt style) into product fields + tab sections.
 */
export function parseLabelTxt(markdown: string): ParsedLabelProduct {
  const blocks = splitBlocks(markdown);
  const productTitleBlock = blocks.find(
    (b) =>
      b.level === 1 &&
      b.title.replace(/\./g, '').trim().toUpperCase() !== 'АГНЮША',
  );
  const productTitle =
    productTitleBlock?.title ??
    blocks.find((b) => b.level === 1)?.title ??
    'Корм Агнюша';

  const category = inferCategory(productTitle, markdown);
  const name = inferName(productTitle, category, markdown);
  const subtitle = inferSubtitle(blocks, productTitle);
  const { protein, fat } = extractNutrition(blocks);
  const variants = extractVariants(blocks, category);
  const weight = variants[0] ?? {
    weightLabel: '800 г.',
    weightGrams: 800,
    price: 1,
    stock: 50,
  };

  const compositionHtml = collectGroupedHtml(
    blocks,
    (b) =>
      (b.level === 2 || b.level === 3) &&
      titleMatches(
        b.title,
        'ингредиенты животного',
        'ингредиенты',
        'основные добавки',
        'состав',
        'анализ состава',
        'жирные кислоты',
        'энергетическая ценность',
        'пищевые добавки',
        'витамины на 1 кг',
        'минералы и прочее',
      ),
  );

  const benefitsHtml = collectGroupedHtml(
    blocks,
    (b) => b.level === 2 && titleMatches(b.title, 'бенефиты', 'польза'),
  );

  const storageHtml = collectGroupedHtml(
    blocks,
    (b) =>
      b.level === 3 &&
      titleMatches(b.title, 'срок годности', 'условия хранения'),
  );

  const feedingHtml = collectGroupedHtml(
    blocks,
    (b) =>
      b.level === 3 &&
      titleMatches(
        b.title,
        'рекомендация по приему',
        'рекомендация по приёму',
        'суточная норма',
      ),
  );

  const sections: ProductSection[] = [];
  const push = (title: string, body: string) => {
    if (body.trim()) sections.push({ title, body });
  };
  push('Состав', compositionHtml);
  push('Польза', benefitsHtml);
  push('Хранение', storageHtml);
  push('Кормление', feedingHtml);

  return {
    name,
    subtitle,
    category,
    nutritionProtein: protein,
    nutritionFat: fat,
    weightLabel: weight.weightLabel,
    weightGrams: weight.weightGrams,
    variants,
    sections,
  };
}
