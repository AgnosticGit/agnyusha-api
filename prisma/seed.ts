import { PrismaClient, DeliveryMethodCode } from '@prisma/client';

const prisma = new PrismaClient();

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

seedDeliveryMethods()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
