import {
  PrismaClient,
  DeliveryMethodCode,
  ProductBadge,
  UserRole,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { legacyBadgeFields } from '../src/products/badge.util';
import { parseLabelTxt } from '../src/products/label-txt.parser';
import { normalizeProductSections } from '../src/products/product-sections.util';
import { slugify } from '../src/products/product.util';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'agnostex@gmail.com';
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

const deliveryMethods = [
  {
    code: DeliveryMethodCode.CDEK,
    title: 'СДЭК',
    description: 'Доставка в пункт выдачи СДЭК',
    sortOrder: 1,
    isActive: true,
  },
  {
    code: DeliveryMethodCode.YANDEX,
    title: 'Яндекс Доставка',
    description: 'Доставка в пункт выдачи Яндекс',
    sortOrder: 2,
    isActive: true,
  },
  {
    code: DeliveryMethodCode.POST,
    title: 'Почта России',
    description: 'Доставка Почтой России',
    sortOrder: 3,
    isActive: true,
  },
  {
    code: DeliveryMethodCode.OZON,
    title: 'Ozon Доставка',
    description: 'Доставка в пункт выдачи Ozon',
    sortOrder: 4,
    isActive: true,
  },
  {
    code: DeliveryMethodCode.PICKUP,
    title: 'Самовывоз',
    description: 'Из пункта в Ленинградской области',
    sortOrder: 5,
    isActive: true,
  },
  {
    code: DeliveryMethodCode.COURIER,
    title: 'Курьер',
    description: 'Доставка курьером по адресу',
      sortOrder: 99,
    isActive: false,
  },
];

/** Full wipe — seed recreates catalog, delivery, admin. */
async function clearDatabase() {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.session.deleteMany();
  await prisma.magicLink.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.deliveryMethod.deleteMany();
  console.log('Database cleared');
}

async function seedDeliveryMethods() {
  for (const method of deliveryMethods) {
    await prisma.deliveryMethod.create({ data: method });
  }
  console.log(
    `Delivery methods: ${deliveryMethods.filter((m) => m.isActive).length} active`,
  );
}

async function seedAdmin() {
  await prisma.user.create({
    data: { email: ADMIN_EMAIL, role: UserRole.ADMIN },
  });
  console.log(`Admin: ${ADMIN_EMAIL}`);
}

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function copySeedImage(srcName: string, destName: string): string {
  const src = path.join(DATA_DIR, srcName);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing seed image: ${src}`);
  }
  const dest = path.join(UPLOADS_DIR, destName);
  fs.copyFileSync(src, dest);
  return `/uploads/${destName}`;
}

function discoverLabelIds(): string[] {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`Seed data folder not found: ${DATA_DIR}`);
  }
  const files = fs.readdirSync(DATA_DIR);
  const ids = new Set<string>();
  for (const file of files) {
    const m = /^(\d+)b\.txt$/i.exec(file);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

function skuFor(id: string, grams: number): string {
  return `AGN-${id}-${grams}`.toUpperCase();
}

async function seedProductsFromData() {
  ensureUploadsDir();
  const ids = discoverLabelIds();
  if (!ids.length) {
    throw new Error(`No *b.txt label files in ${DATA_DIR}`);
  }

  let sortOrder = 1;
  for (const id of ids) {
    const txtPath = path.join(DATA_DIR, `${id}b.txt`);
    const markdown = fs.readFileSync(txtPath, 'utf8');
    const parsed = parseLabelTxt(markdown);
    const sections = normalizeProductSections(parsed.sections);

    const cover = copySeedImage(`${id}.png`, `seed-${id}.png`);
    const labelImg = copySeedImage(`${id}b.png`, `seed-${id}b.png`);
    const images = [cover, labelImg];

    const badgeEnum =
      sortOrder === 1
        ? ProductBadge.HIT
        : sortOrder === 2
          ? ProductBadge.NEW
          : ProductBadge.NONE;
    const badge = legacyBadgeFields(badgeEnum, null);

    const slugBase = slugify(parsed.name);
    const slug = `${slugBase}-${id}`;

    await prisma.product.create({
      data: {
        slug,
        name: parsed.name,
        subtitle: parsed.subtitle,
        image: cover,
        images,
        category: parsed.category,
        badge: badgeEnum,
        badgeLabel: badge.badgeLabel,
        badgeColor: badge.badgeColor,
        discountPercent: null,
        sections,
        nutritionProtein: parsed.nutritionProtein,
        nutritionFat: parsed.nutritionFat,
        nutritionCarbs: null,
        sortOrder,
        isActive: true,
        isPopular: sortOrder <= 4,
        variants: {
          create: parsed.variants.map((v, index) => ({
            sku: skuFor(id, v.weightGrams),
            weight: v.weightLabel,
            weightGrams: v.weightGrams,
            price: v.price,
            stock: v.stock,
            sortOrder: index,
          })),
        },
      },
    });

    console.log(`Product ${id}: ${parsed.name} (${parsed.category})`);
    sortOrder += 1;
  }
  console.log(`Products: ${ids.length} from data/`);
}

async function main() {
  await clearDatabase();
  await seedDeliveryMethods();
  await seedAdmin();
  await seedProductsFromData();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
