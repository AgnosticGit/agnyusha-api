import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { StaffPermission } from '@prisma/client';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { ProductsService } from './products.service';
import { UpdateStockDto, UpsertProductDto } from './dto/product.dto';
import { ListInventoryDto } from './dto/list-inventory.dto';
import {
  PermissionsGuard,
  ProductsAccessGuard,
  RequirePermissions,
} from '../auth/auth.guard';

const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const MAX_PRODUCT_IMAGES = 12;

const imageUploadOptions = {
  storage: diskStorage({
    destination: uploadsDir,
    filename: (
      _req: Express.Request,
      file: Express.Multer.File,
      cb: (error: Error | null, filename: string) => void,
    ) => {
      const ext = extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      cb(new BadRequestException('Нужен файл изображения') as never, false);
      return;
    }
    cb(null, true);
  },
};

@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  listPublic() {
    return this.products.listPublic();
  }

  @Get('products/:slug')
  getPublicBySlug(@Param('slug') slug: string) {
    return this.products.getPublicBySlug(slug);
  }

  @Get('admin/products')
  @UseGuards(ProductsAccessGuard)
  listAdmin() {
    return this.products.listAdmin();
  }

  @Get('admin/products/:id')
  @UseGuards(ProductsAccessGuard)
  getOne(@Param('id') id: string) {
    return this.products.getById(id);
  }

  @Post('admin/products')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(StaffPermission.PRODUCT_CREATE)
  @HttpCode(201)
  create(@Body() body: UpsertProductDto) {
    return this.products.create(body);
  }

  @Patch('admin/products/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(StaffPermission.PRODUCT_EDIT)
  update(@Param('id') id: string, @Body() body: UpsertProductDto) {
    return this.products.update(id, body);
  }

  @Delete('admin/products/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(StaffPermission.PRODUCT_DELETE)
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }

  @Post('admin/products/:id/images')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(StaffPermission.PRODUCT_EDIT, StaffPermission.PRODUCT_CREATE)
  @UseInterceptors(FilesInterceptor('files', MAX_PRODUCT_IMAGES, imageUploadOptions))
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Файл не получен');
    return this.products.appendImages(
      id,
      files.map((file) => `/uploads/${file.filename}`),
    );
  }

  @Get('admin/inventory')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(StaffPermission.PRODUCT_STOCK)
  listInventory(@Query() query: ListInventoryDto) {
    return this.products.listInventory({
      q: query.q,
      page: query.page,
      limit: query.limit,
    });
  }

  @Patch('admin/inventory/:variantId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(StaffPermission.PRODUCT_STOCK)
  updateStock(
    @Param('variantId') variantId: string,
    @Body() body: UpdateStockDto,
  ) {
    return this.products.updateStock(variantId, body.stock);
  }
}
