import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type SiteSetting } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { prepareArticleContent } from '../articles/article.util';

export const SITE_PAGE_SLUGS = [
  'declaration',
  'certificate',
  'privacy',
] as const;
export type SitePageSlug = (typeof SITE_PAGE_SLUGS)[number];

const DEFAULT_CONTENT: Record<SitePageSlug, string> = {
  declaration:
    '<p>Продукция «Агнюша» задекларирована и соответствует требованиям ГОСТ Р 55453-2022 «Корма для непродуктивных животных. Общие технические условия».</p><p>Декларация о соответствии № РОСС RU Д-RU.РА01.В.37609/23 принята на основании протокола испытаний Северо-Западной испытательной лаборатории ФГБУ «ВНИИЗЖ». Срок действия: с 27.09.2023 по 24.09.2026.</p><p><img src="/assets/declaration.webp" alt="Декларация о соответствии продукции Агнюша" /></p>',
  certificate:
    '<p>Продукция «Агнюша» прошла добровольную сертификацию и соответствует требованиям нормативных документов по составу и качеству (влага, сырой жир, сырой протеин, сырая клетчатка) согласно ТУ 10.92.10-001-0155103199-2023.</p><p>Сертификат соответствия № РОСС RU.АА80.Н.00021 выдан Федеральным центром охраны здоровья животных (ФГБУ «ВНИИЗЖ») в системе добровольной сертификации «ВНИИЗЖ-СТАНДАРТ». Срок действия: с 02.11.2023 по 01.11.2026.</p><p><img src="/assets/certificate.webp" alt="Сертификат соответствия продукции Агнюша" /></p>',
  privacy:
    '<p>Положение об обработке персональных данных по поручению (согласно ст. 6 Федерального закона № 152-ФЗ «О персональных данных»)</p><h2>Предмет соглашения</h2><p>Оператор (Заказчик) поручает, а Исполнитель (ИП Марголин А.К.) обязуется осуществлять обработку персональных данных (ПДн) клиентов.</p><h2>Цель обработки</h2><p>Доставка заказов, информирование о статусе доставки, возврат товаров.</p><h2>Перечень передаваемых данных</h2><ul><li>Фамилия и имя.</li><li>Номер контактного телефона.</li><li>Адрес доставки (страна, регион, город, улица, дом, квартира/офис).</li></ul><h2>Перечень разрешённых действий</h2><ul><li>Сбор (получение от Оператора).</li><li>Запись, систематизация, накопление, хранение.</li><li>Уточнение (обновление, изменение).</li><li>Использование (исключительно для связи и доставки).</li><li>Уничтожение (после выполнения обязательств).</li></ul><h2>Обязанности Исполнителя</h2><ul><li>Соблюдать конфиденциальность ПДн согласно ст. 7 ФЗ-152.</li><li>Обеспечивать безопасность данных по ст. 19 ФЗ-152.</li><li>Применять технические меры защиты от несанкционированного доступа.</li><li>Уничтожить ПДн или вернуть их Оператору в течение 30 дней после завершения доставки.</li><li>Предоставлять по запросу Оператора документы, подтверждающие безопасность данных.</li></ul>',
};

const pageKey = (slug: SitePageSlug) => `legal-page:${slug}`;

function contentFromRow(row: SiteSetting | null, fallback: string): string {
  if (!row || !row.value || typeof row.value !== 'object') return fallback;
  const value = row.value as Record<string, unknown>;
  return typeof value.contentHtml === 'string' ? value.contentHtml : fallback;
}

@Injectable()
export class SitePagesService {
  constructor(private readonly prisma: PrismaService) {}

  isValidSlug(slug: string): slug is SitePageSlug {
    return SITE_PAGE_SLUGS.includes(slug as SitePageSlug);
  }

  private assertSlug(slug: string): asserts slug is SitePageSlug {
    if (!this.isValidSlug(slug)) {
      throw new BadRequestException('Неизвестная страница');
    }
  }

  async get(
    slug: string,
  ): Promise<{ slug: SitePageSlug; contentHtml: string }> {
    this.assertSlug(slug);
    const row = await this.prisma.siteSetting.findUnique({
      where: { key: pageKey(slug) },
    });
    const contentHtml = prepareArticleContent(
      contentFromRow(row, DEFAULT_CONTENT[slug]),
    ).contentHtml;
    return { slug, contentHtml };
  }

  async update(
    slug: string,
    contentHtml: string,
  ): Promise<{ slug: SitePageSlug; contentHtml: string }> {
    this.assertSlug(slug);
    const safeHtml = prepareArticleContent(contentHtml).contentHtml;
    await this.prisma.siteSetting.upsert({
      where: { key: pageKey(slug) },
      create: {
        key: pageKey(slug),
        value: { contentHtml: safeHtml } as Prisma.InputJsonValue,
      },
      update: { value: { contentHtml: safeHtml } as Prisma.InputJsonValue },
    });
    return { slug, contentHtml: safeHtml };
  }
}
