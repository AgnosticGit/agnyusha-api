import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import {
  ArticlesAccessGuard,
  type AuthedRequest,
} from '../auth/auth.guard';
import { CreateArticleDto, UpsertArticleDto } from './dto/article.dto';
import { ArticlesService } from './articles.service';

class ListArticlesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const MAX_ARTICLE_IMAGES = 8;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const imageUploadOptions = {
  storage: diskStorage({
    destination: uploadsDir,
    filename: (
      _req: Express.Request,
      file: Express.Multer.File,
      cb: (error: Error | null, filename: string) => void,
    ) => {
      const ext = MIME_TO_EXT[file.mimetype] ?? '.jpg';
      cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!MIME_TO_EXT[file.mimetype]) {
      cb(new BadRequestException('Нужен файл изображения'), false);
      return;
    }
    const ext = extname(file.originalname).toLowerCase();
    const allowedExt = Object.values(MIME_TO_EXT);
    if (ext && !allowedExt.includes(ext) && ext !== '.jpeg') {
      cb(new BadRequestException('Нужен файл изображения'), false);
      return;
    }
    cb(null, true);
  },
};

function assertImageMagic(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return true;
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return true;
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }
  return false;
}

@Controller('articles')
export class PublicArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  list(@Query() query: ListArticlesQueryDto) {
    return this.articles.listPublished(query.page, query.limit);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.articles.getPublishedBySlug(slug);
  }
}

@Controller('admin/articles')
@UseGuards(ArticlesAccessGuard)
export class AdminArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  list() {
    return this.articles.adminList();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.articles.adminGet(id);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateArticleDto) {
    return this.articles.create(req.user!.id, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpsertArticleDto) {
    return this.articles.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.articles.remove(id);
  }

  /**
   * Same uploads/ pipeline as product images, but gated by ARTICLE_MANAGE
   * (product upload requires PRODUCT_* and attaches to a product).
   */
  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('files', MAX_ARTICLE_IMAGES, imageUploadOptions),
  )
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    await this.articles.adminGet(id);
    if (!files?.length) throw new BadRequestException('Файл не получен');

    const accepted: string[] = [];
    for (const file of files) {
      const fullPath = join(uploadsDir, file.filename);
      const head = readFileSync(fullPath).subarray(0, 16);
      if (!assertImageMagic(head)) {
        for (const path of accepted) {
          try {
            unlinkSync(join(uploadsDir, path.replace(/^\/uploads\//, '')));
          } catch {
            /* ignore */
          }
        }
        try {
          unlinkSync(fullPath);
        } catch {
          /* ignore */
        }
        throw new BadRequestException('Файл не является изображением');
      }
      accepted.push(`/uploads/${file.filename}`);
    }

    return { urls: accepted };
  }
}
