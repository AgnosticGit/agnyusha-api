import { SettingsService } from '../../src/settings/settings.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

describe('SettingsService cache', () => {
  function makeService() {
    const findUnique = jest.fn().mockResolvedValue({
      key: 'site',
      value: { inventoryEnabled: true, articlesEnabled: true },
    });
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      siteSetting: { findUnique, upsert },
    } as unknown as PrismaService;
    const service = new SettingsService(prisma);
    return { service, findUnique, upsert };
  }

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('reuses getAll within TTL outside test env', async () => {
    process.env.NODE_ENV = 'development';
    const { service, findUnique } = makeService();
    await service.getAll();
    await service.getAll();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('skips cache in test env so prisma helpers stay consistent', async () => {
    process.env.NODE_ENV = 'test';
    const { service, findUnique } = makeService();
    await service.getAll();
    await service.getAll();
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on update', async () => {
    process.env.NODE_ENV = 'development';
    const { service, findUnique } = makeService();
    await service.getAll();
    await service.update({ reviewsEnabled: false });
    findUnique.mockResolvedValue({
      key: 'site',
      value: { inventoryEnabled: true, reviewsEnabled: false },
    });
    await service.getAll();
    // update set cache from next value; third getAll still cached until TTL
    expect(findUnique).toHaveBeenCalledTimes(1);
    const all = await service.getAll();
    expect(all.reviewsEnabled).toBe(false);
  });
});
