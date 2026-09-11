import { PrismaClient } from '@prisma/client';

const PRICE = 1;
const prisma = new PrismaClient();

const result = await prisma.productVariant.updateMany({
  data: { price: PRICE },
});

console.log(`Цены вариантов: ${result.count} шт. → ${PRICE} ₽`);
await prisma.$disconnect();
