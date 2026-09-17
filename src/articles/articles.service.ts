import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatPublicDisplayName } from '../common/person-name';
import {
  prepareArticleContent,
  slugifyTitle,
  type ArticleTocItem,
} from './article.util';
import type { CreateArticleDto, UpsertArticleDto } from './dto/article.dto';

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImage: string;
  contentHtml: string;
  contentJson: Prisma.JsonValue;
  toc: Prisma.JsonValue;
  status: ArticleStatus;
  publishedAt: Date | null;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  author?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
};

@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  private authorSelect = {
    select: { id: true, email: true, firstName: true, lastName: true },
  } as const;

  /** Card/list fields — omit heavy contentHtml/contentJson bodies. */
  private listSelect = {
    id: true,
    slug: true,
    title: true,
    excerpt: true,
    coverImage: true,
    toc: true,
    status: true,
    publishedAt: true,
    authorId: true,
    createdAt: true,
    updatedAt: true,
    author: this.authorSelect,
  } as const;

  private map(row: ArticleRow, opts?: { includeContent?: boolean }) {
    const includeContent = opts?.includeContent !== false;
    const toc = Array.isArray(row.toc) ? (row.toc as ArticleTocItem[]) : [];
    const authorName = formatPublicDisplayName(row.author) ?? undefined;

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      coverImage: row.coverImage,
      ...(includeContent
        ? {
            contentHtml: row.contentHtml,
            contentJson: row.contentJson ?? {},
            toc,
          }
        : { toc }),
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      authorId: row.authorId,
      authorName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    const root = base || `article-${Date.now()}`;
    const candidates = [root, ...Array.from({ length: 20 }, (_, i) => `${root}-${i + 2}`)];
    const taken = await this.prisma.article.findMany({
      where: { slug: { in: candidates } },
      select: { id: true, slug: true },
    });
    const blocked = new Set(
      taken.filter((row) => row.id !== excludeId).map((row) => row.slug),
    );
    for (const slug of candidates) {
      if (!blocked.has(slug)) return slug;
    }
    return `${root}-${Date.now()}`;
  }

  async listPublished(page = 1, limit = 12) {
    const take = Math.min(50, Math.max(1, Math.trunc(limit) || 12));
    const current = Math.max(1, Math.trunc(page) || 1);
    const where = { status: ArticleStatus.PUBLISHED };
    const [total, rows] = await Promise.all([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        select: this.listSelect,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (current - 1) * take,
        take,
      }),
    ]);
    return {
      items: rows.map((r) =>
        this.map(
          {
            ...r,
            contentHtml: '',
            contentJson: {},
          } as ArticleRow,
          { includeContent: false },
        ),
      ),
      page: current,
      limit: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async getPublishedBySlug(slug: string) {
    const row = await this.prisma.article.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED },
      include: {
        author: this.authorSelect,
      },
    });
    if (!row) throw new NotFoundException('Статья не найдена');
    return this.map(row);
  }

  async adminList() {
    const rows = await this.prisma.article.findMany({
      select: this.listSelect,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) =>
      this.map(
        {
          ...r,
          contentHtml: '',
          contentJson: {},
        } as ArticleRow,
        { includeContent: false },
      ),
    );
  }

  async adminGet(id: string) {
    const row = await this.prisma.article.findUnique({
      where: { id },
      include: {
        author: this.authorSelect,
      },
    });
    if (!row) throw new NotFoundException('Статья не найдена');
    return this.map(row);
  }

  async create(authorId: string, dto: CreateArticleDto) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Укажите заголовок');

    const status = dto.status ?? ArticleStatus.DRAFT;
    const { contentHtml, toc } = prepareArticleContent(dto.contentHtml ?? '');
    const slug = await this.uniqueSlug(
      (dto.slug?.trim() ? slugifyTitle(dto.slug) : slugifyTitle(title)) ||
        `article-${Date.now()}`,
    );

    const publishedAt =
      status === ArticleStatus.PUBLISHED ? new Date() : null;

    try {
      const row = await this.prisma.article.create({
        data: {
          title,
          slug,
          excerpt: (dto.excerpt ?? '').trim(),
          coverImage: (dto.coverImage ?? '').trim(),
          contentHtml,
          contentJson: (dto.contentJson ?? {}) as Prisma.InputJsonValue,
          toc: toc as unknown as Prisma.InputJsonValue,
          status,
          publishedAt,
          authorId,
        },
        include: {
          author: this.authorSelect,
        },
      });
      return this.map(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Статья с таким slug уже есть');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpsertArticleDto) {
    const existing = await this.prisma.article.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Статья не найдена');

    const title =
      dto.title !== undefined ? dto.title.trim() : existing.title;
    if (!title) throw new BadRequestException('Укажите заголовок');

    const status = dto.status ?? existing.status;
    const { contentHtml, toc } =
      dto.contentHtml !== undefined
        ? prepareArticleContent(dto.contentHtml)
        : {
            contentHtml: existing.contentHtml,
            toc: (Array.isArray(existing.toc)
              ? existing.toc
              : []) as ArticleTocItem[],
          };

    let slug = existing.slug;
    if (dto.slug !== undefined && dto.slug.trim()) {
      slug = await this.uniqueSlug(slugifyTitle(dto.slug), id);
    } else if (dto.title !== undefined && dto.slug === undefined) {
      // Keep existing slug when only title changes unless slug explicitly sent.
      slug = existing.slug;
    }

    let publishedAt = existing.publishedAt;
    if (status === ArticleStatus.PUBLISHED && !publishedAt) {
      publishedAt = new Date();
    }
    if (status === ArticleStatus.DRAFT) {
      // Keep publishedAt history when unpublishing so republish can keep date,
      // but only set on first publish — do not clear.
    }

    try {
      const row = await this.prisma.article.update({
        where: { id },
        data: {
          title,
          slug,
          excerpt:
            dto.excerpt !== undefined
              ? dto.excerpt.trim()
              : existing.excerpt,
          coverImage:
            dto.coverImage !== undefined
              ? dto.coverImage.trim()
              : existing.coverImage,
          contentHtml,
          ...(dto.contentJson !== undefined
            ? {
                contentJson: dto.contentJson as Prisma.InputJsonValue,
              }
            : {}),
          toc: toc as unknown as Prisma.InputJsonValue,
          status,
          publishedAt,
        },
        include: {
          author: this.authorSelect,
        },
      });
      return this.map(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Статья с таким slug уже есть');
      }
      throw e;
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.article.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Статья не найдена');
    await this.prisma.article.delete({ where: { id } });
    return { ok: true as const };
  }
}
