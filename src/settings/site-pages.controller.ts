import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StaffPermission } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { PermissionsGuard, RequirePermissions } from '../auth/auth.guard';
import { UpdateSitePageDto } from './dto/update-site-page.dto';
import { SitePagesService } from './site-pages.service';

const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const sitePageImageOptions = {
  storage: diskStorage({
    destination: uploadsDir,
    filename: (
      _req: Express.Request,
      file: Express.Multer.File,
      cb: (error: Error | null, filename: string) => void,
    ) =>
      cb(
        null,
        `${Date.now()}-${randomBytes(6).toString('hex')}${MIME_TO_EXT[file.mimetype] ?? '.jpg'}`,
      ),
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
    if (ext && !Object.values(MIME_TO_EXT).includes(ext) && ext !== '.jpeg') {
      cb(new BadRequestException('Нужен файл изображения'), false);
      return;
    }
    cb(null, true);
  },
};

function hasValidImageSignature(buffer: Buffer): boolean {
  return (
    (buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff) ||
    (buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )) ||
    (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'GIF8') ||
    (buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP')
  );
}

@Controller('site-pages')
export class PublicSitePagesController {
  constructor(private readonly pages: SitePagesService) {}

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.pages.get(slug);
  }
}

@Controller('admin/site-pages')
@UseGuards(PermissionsGuard)
@RequirePermissions(StaffPermission.SITE_PAGE_EDIT)
export class AdminSitePagesController {
  constructor(private readonly pages: SitePagesService) {}

  @Patch(':slug')
  update(@Param('slug') slug: string, @Body() body: UpdateSitePageDto) {
    return this.pages.update(slug, body.contentHtml);
  }

  @Post('images')
  @UseInterceptors(FileInterceptor('file', sitePageImageOptions))
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не получен');
    const fullPath = join(uploadsDir, file.filename);
    const head = readFileSync(fullPath).subarray(0, 16);
    if (!hasValidImageSignature(head)) {
      unlinkSync(fullPath);
      throw new BadRequestException('Файл не является изображением');
    }
    return { url: `/uploads/${file.filename}` };
  }
}
