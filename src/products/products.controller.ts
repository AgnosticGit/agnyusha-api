import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
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
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { ProductsService } from './products.service';
import { UpdateStockDto, UpsertProductDto } from './dto/product.dto';
import { ListInventoryDto } from './dto/list-inventory.dto';
import {
  PermissionsGuard,
  ProductsAccessGuard,
  RequirePermissions,
} from '../auth/auth.guard';
import { ConfigService } from '@nestjs/config';
import { isInventoryEnabled } from '../common/inventory';

const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const MAX_PRODUCT_IMAGES = 12;

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
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return true;
  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }
  // GIF
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return true;
  }
  // WEBP (RIFF....WEBP)
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

@Controller()
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly config: ConfigService,
  ) {}

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
  @RequirePermissions(
    StaffPermission.PRODUCT_EDIT,
    StaffPermission.PRODUCT_CREATE,
  )
  @UseInterceptors(
    FilesInterceptor('files', MAX_PRODUCT_IMAGES, imageUploadOptions),
  )
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
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

    return this.products.appendImages(id, accepted);
  }

  @Get('admin/inventory')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(StaffPermission.PRODUCT_STOCK)
  listInventory(@Query() query: ListInventoryDto) {
    if (!isInventoryEnabled(this.config)) {
      throw new NotFoundException('Инвентаризация отключена');
    }
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
    if (!isInventoryEnabled(this.config)) {
      throw new NotFoundException('Инвентаризация отключена');
    }
    return this.products.updateStock(variantId, body.stock);
  }
}
