import {
  PrismaClient,
  DeliveryMethodCode,
  ProductBadge,
  ProductCategory,
  UserRole,
} from '@prisma/client';
import { legacyBadgeFields } from '../src/products/badge.util';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'agnostex@gmail.com';

const productsSeed = [
  {
    slug: 'turkey',
    name: 'Корм для собак из индейки',
    subtitle: 'Подходит для собак всех пород',
    image: '/assets/product-turkey.png',
    category: ProductCategory.DOGS,
    badge: ProductBadge.HIT,
    discountPercent: null as number | null,
    sortOrder: 1,
    nutritionProtein: 28,
    nutritionFat: 16,
    nutritionCarbs: 42,
    variants: [
      { sku: 'AGN-TURKEY-01', weight: '0,8 кг.', price: 725, stock: 50 },
      { sku: 'AGN-TURKEY-02', weight: '2,5 кг.', price: 1850, stock: 40 },
      { sku: 'AGN-TURKEY-03', weight: '5 кг.', price: 3400, stock: 30 },
      { sku: 'AGN-TURKEY-04', weight: '12 кг.', price: 7200, stock: 20 },
    ],
    ingredients:
      'Мясные ингредиенты 55% (свежее мясо индейки 27%, дегидрированное мясо птицы премиум класса 14%, дегидрированное мясо птицы стандарт 14%) рис, животный жир (источник омега 6), гречка, кукуруза, овсяные хлопья, глютен, пивные дрожжи (источник MOS и витаминов группы B), льняное семя (источник омега 3), сушеный корень цикория (натуральный источник инулина), витаминно-минеральные комплексы, тыква, томат (источник ликопина и минералов), свекла, яблоко, Экстракт Юкки Шидигера, яичный порошок, целлюлоза микрокристаллическая.',
    description:
      'Калий, медь, железо, цинк, марганец, йод, селен, глюкозамин, хондроэтин, L-карнитин, розмарин, стабилизирован антиоксидантами (в том числе экстракт розмарина и витамины Е и С), премикс (витаминно-минеральный комплекс). Витамины А, D3, E, B1, B2, B3, B4, B5, B6, B12, BC, H, C, Ca. Рыбий жир, Монокальций фосфат, Гидролизат мясной премиум (ароматизатор).',
  },
  {
    slug: 'beef',
    name: 'Корм для собак из говядины',
    subtitle: 'Подходит для собак всех пород',
    image: '/assets/product-beef.png',
    category: ProductCategory.DOGS,
    badge: ProductBadge.NEW,
    discountPercent: null,
    sortOrder: 2,
    nutritionProtein: 29,
    nutritionFat: 17,
    nutritionCarbs: 40,
    variants: [
      { sku: 'AGN-BEEF-01', weight: '0,8 кг.', price: 800, stock: 50 },
      { sku: 'AGN-BEEF-02', weight: '2,5 кг.', price: 2050, stock: 40 },
      { sku: 'AGN-BEEF-03', weight: '5 кг.', price: 3750, stock: 30 },
      { sku: 'AGN-BEEF-04', weight: '12 кг.', price: 7900, stock: 20 },
    ],
    ingredients:
      'Мясные ингредиенты 55% (свежее мясо говядины 27%, дегидрированное мясо говядины 14%, дегидрированное мясо птицы премиум класса 14%) картофель, рис, животный жир (источник омега 6), гречка, кукуруза, овсяные хлопья, глютен, пивные дрожжи (источник MOS и витаминов группы B), льняное семя (источник омега 3), сушеный корень цикория (натуральный источник инулина), целлюлоза микрокристаллическая, тыква, томат (источник ликопина и минералов), свекла, яблоко, Экстракт Юкки Шидигера, яичный порошок, розмарин, стабилизирован антиоксидантами (в том числе экстракт розмарина и витамины Е и С).',
    description:
      'Калий, медь, железо, цинк, марганец, йод, селен, термокс, микокарб 23, Премикс (витаминно-минеральный комплекс). Витамины А, Д3, Е, В1, В2, В3, В4, В5, В6, В12, ВС, Н, С, Ca. Рыбий жир, хондроэтин, Глюкозамин, L-Карнитин, Монокальций фосфат, Гидролизат мясной премиум (ароматизатор).',
  },
  {
    slug: 'fish',
    name: 'Корм для собак из рыбы',
    subtitle: 'Подходит для собак всех пород',
    image: '/assets/product-fish.jpg',
    category: ProductCategory.DOGS,
    badge: ProductBadge.SALE,
    discountPercent: 15,
    sortOrder: 3,
    nutritionProtein: 27,
    nutritionFat: 14,
    nutritionCarbs: 43,
    variants: [
      { sku: 'AGN-FISH-01', weight: '0,8 кг.', price: 855, stock: 50 },
      { sku: 'AGN-FISH-02', weight: '2,5 кг.', price: 2200, stock: 40 },
      { sku: 'AGN-FISH-03', weight: '5 кг.', price: 4000, stock: 30 },
      { sku: 'AGN-FISH-04', weight: '12 кг.', price: 8500, stock: 20 },
    ],
    ingredients:
      'Мясные ингредиенты 55% (свежее мясо белой рыбы 27%, дегидрированная белая рыба 14%, дегидрированное мясо птицы премиум класса 14%) рис, животный жир (источник омега 6), гречка, кукуруза, овсяные хлопья, глютен, пивные дрожжи (источник MOS и витаминов группы B), льняное семя (источник омега 3), сушеный корень цикория (натуральный источник инулина), целлюлоза микрокристаллическая, витаминно-минеральные комплексы, тыква, томат (источник ликопина и минералов), свекла, яблоко, Экстракт Юкки Шидигера, яичный порошок, L-карнитин, розмарин.',
    description:
      'Калий, медь, железо, цинк, марганец, йод, селен, глюкозамин, хондроэтин, L-карнитин, стабилизирован антиоксидантами (в том числе экстракт розмарина и витамины Е и С), термокс, микокарб 23, премикс (витаминно-минеральный комплекс). Витамины А, D3, Е, В1, В2, В3, В4, В5, В6, В12, ВС, Н, С, Ca. Рыбий жир, Монокальций фосфат, Гидролизат мясной премиум (ароматизатор).',
  },
  {
    slug: 'cat-fish',
    name: 'Корм для взрослых кошек с рыбой',
    subtitle: 'Подходит для стерилизованных кошек и кастрированных котов',
    image: '/assets/product-cat-fish.jpg',
    category: ProductCategory.CATS,
    badge: ProductBadge.HIT,
    discountPercent: null,
    sortOrder: 4,
    nutritionProtein: 36,
    nutritionFat: 12,
    nutritionCarbs: 30,
    variants: [
      { sku: 'AGN-CATFISH-01', weight: '0,25 кг.', price: 400, stock: 50 },
      { sku: 'AGN-CATFISH-02', weight: '2,5 кг.', price: 2800, stock: 30 },
    ],
    ingredients:
      'Мясные ингредиенты 53% (свежая белая рыба 23%, дегидрированная рыба 10%, дегидрированная домашняя птица 16%, гидролизат печени 4%) картофель, маисовый протеин, рис, животный жир (источник омега 6), плазма крови, пивные дрожжи (источник MOS и витаминов группы B), льняное семя и рыбий жир (источник омега 3), сушеный корень цикория (натуральный источник инулина), метионин, таурин, витаминно-минеральные комплексы, экстракт Юкки Шидигера, клюква, L-карнитин, розмарин, стабилизирован антиоксидантами (в том числе экстракт розмарина и витамины Е и С), целлюлоза микрокристаллическая.',
    description: 'Калий, медь, железо, цинк, марганец, йод, селен, таурин, метионин, L-карнитин.',
  },
  {
    slug: 'kitten',
    name: 'Корм для котят с индейкой и курицей',
    subtitle: 'Подходит для котят всех пород',
    image: '/assets/product-kitten.png',
    category: ProductCategory.CATS,
    badge: ProductBadge.NEW,
    discountPercent: null,
    sortOrder: 5,
    nutritionProtein: 34,
    nutritionFat: 18,
    nutritionCarbs: 32,
    variants: [
      { sku: 'AGN-KITTEN-01', weight: '0,25 кг.', price: 430, stock: 50 },
      { sku: 'AGN-KITTEN-02', weight: '0,7 кг.', price: 980, stock: 40 },
      { sku: 'AGN-KITTEN-03', weight: '2,5 кг.', price: 2950, stock: 30 },
    ],
    ingredients:
      'Мясные ингредиенты 46% (дегидрированная индейка 26%, свежее мясо курицы 20%) кукуруза, рис, кукурузный белок, животный жир (источник омега 6), гидролизат печени, гороховый протеин, плазма крови, пивные дрожжи (источник MOS и витаминов группы B), льняное семя и рыбий жир (источник омега 3), сушеная мякоть свеклы, сушеный корень цикория (натуральный источник инулина), метионин, таурин, витаминно-минеральные комплексы, экстракт Юкки Шидигера, L-карнитин, розмарин, стабилизирован антиоксидантами (в том числе экстракт розмарина и витамины Е и С), целлюлоза микрокристаллическая.',
    description: 'Калий, медь, железо, цинк, марганец, йод, селен, таурин, метионин, L-карнитин.',
  },
];

async function seedDeliveryMethods() {
  const methods = [
    {
      code: DeliveryMethodCode.PICKUP,
      title: 'Самовывоз',
      description: 'Из пункта в Ленинградской области',
      sortOrder: 1,
    },
    {
      code: DeliveryMethodCode.COURIER,
      title: 'Курьер',
      description: 'Доставка курьером по адресу',
      sortOrder: 2,
    },
    {
      code: DeliveryMethodCode.CDEK,
      title: 'СДЭК',
      description: 'Доставка в пункт выдачи СДЭК',
      sortOrder: 3,
    },
    {
      code: DeliveryMethodCode.YANDEX,
      title: 'Яндекс Доставка',
      description: 'Доставка в пункт выдачи Яндекс',
      sortOrder: 4,
    },
    {
      code: DeliveryMethodCode.POST,
      title: 'Почта России',
      description: 'Доставка Почтой России',
      sortOrder: 5,
    },
  ];

  for (const method of methods) {
    await prisma.deliveryMethod.upsert({
      where: { code: method.code },
      create: method,
      update: {
        title: method.title,
        description: method.description,
        sortOrder: method.sortOrder,
        isActive: true,
      },
    });
  }
  console.log(`Delivery methods: ${methods.length}`);
}

async function seedAdmin() {
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: { email: ADMIN_EMAIL, role: UserRole.ADMIN },
    update: { role: UserRole.ADMIN },
  });
  console.log(`Admin: ${ADMIN_EMAIL}`);
}

async function seedProducts() {
  for (const p of productsSeed) {
    const badge = legacyBadgeFields(p.badge, p.discountPercent);
    const { variants, ...rest } = p;
    const productData = {
      ...rest,
      images: [p.image],
      badgeLabel: badge.badgeLabel,
      badgeColor: badge.badgeColor,
    };

    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      create: productData,
      update: {
        name: p.name,
        subtitle: p.subtitle,
        image: p.image,
        images: [p.image],
        category: p.category,
        badge: p.badge,
        badgeLabel: badge.badgeLabel,
        badgeColor: badge.badgeColor,
        discountPercent: p.discountPercent,
        ingredients: p.ingredients,
        description: p.description,
        nutritionProtein: p.nutritionProtein,
        nutritionFat: p.nutritionFat,
        nutritionCarbs: p.nutritionCarbs,
        sortOrder: p.sortOrder,
        isActive: true,
      },
    });

    for (const [index, v] of variants.entries()) {
      const existing = await prisma.productVariant.findFirst({
        where: {
          OR: [{ sku: v.sku }, { productId: product.id, weight: v.weight }],
        },
      });
      if (existing) {
        await prisma.productVariant.update({
          where: { id: existing.id },
          data: {
            sku: v.sku,
            weight: v.weight,
            price: v.price,
            stock: v.stock,
            sortOrder: index,
            productId: product.id,
          },
        });
      } else {
        await prisma.productVariant.create({
          data: {
            productId: product.id,
            sku: v.sku,
            weight: v.weight,
            price: v.price,
            stock: v.stock,
            sortOrder: index,
          },
        });
      }
    }
  }
  console.log(`Products: ${productsSeed.length}`);
}

async function main() {
  await seedDeliveryMethods();
  await seedAdmin();
  await seedProducts();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
