import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { ProductsService } from './products.service';
import { UpsertProductDto } from './dto/product.dto';
import { AdminGuard } from '../auth/auth.guard';

const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  listPublic() {
    return this.products.listPublic();
  }

  @Get('admin/products')
  @UseGuards(AdminGuard)
  listAdmin() {
    return this.products.listAdmin();
  }

  @Get('admin/products/:id')
  @UseGuards(AdminGuard)
  getOne(@Param('id') id: string) {
    return this.products.getById(id);
  }

  @Post('admin/products')
  @UseGuards(AdminGuard)
  @HttpCode(201)
  create(@Body() body: UpsertProductDto) {
    return this.products.create(body);
  }

  @Patch('admin/products/:id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() body: UpsertProductDto) {
    return this.products.update(id, body);
  }

  @Delete('admin/products/:id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }

  @Post('admin/products/:id/image')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadsDir,
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || '.jpg';
          cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
          cb(new BadRequestException('Нужен файл изображения') as never, false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл не получен');
    return this.products.setImage(id, `/uploads/${file.filename}`);
  }
}
