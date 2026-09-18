import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createTestApp } from './helpers/cdek-test.helpers';
import { loginAs } from './helpers/login-as';
import { PrismaService } from '../src/prisma/prisma.service';

const DEFAULT_LOCATION = {
  city: 'Санкт-Петербург',
  address: 'Гранитная 51',
};

const DEFAULT_SCHEDULE = [
  { weekday: 0, open: false, startTime: '12:00', endTime: '14:00' },
  { weekday: 1, open: true, startTime: '12:00', endTime: '14:00' },
  { weekday: 2, open: true, startTime: '12:00', endTime: '14:00' },
  { weekday: 3, open: true, startTime: '12:00', endTime: '14:00' },
  { weekday: 4, open: true, startTime: '12:00', endTime: '14:00' },
  { weekday: 5, open: true, startTime: '12:00', endTime: '14:00' },
  { weekday: 6, open: true, startTime: '12:00', endTime: '14:00' },
];

describe('Pickup settings (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const created = await createTestApp({ cdek: 'missing', yandex: 'missing' });
    app = created.app;
    const prisma = app.get(PrismaService);
    await prisma.pickupSettings.deleteMany({});
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.pickupSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        address: 'Санкт-Петербург, Гранитная 51',
        minLeadDays: 1,
        phones: ['+7 (911) 228-31-92'],
        locations: [DEFAULT_LOCATION],
        schedule: DEFAULT_SCHEDULE,
      },
      update: {
        address: 'Санкт-Петербург, Гранитная 51',
        minLeadDays: 1,
        phones: ['+7 (911) 228-31-92'],
        locations: [DEFAULT_LOCATION],
        schedule: DEFAULT_SCHEDULE,
      },
    });
    await app.close();
  });

  it('returns default public pickup settings and slots', async () => {
    const res = await request(app.getHttpServer()).get('/api/pickup').expect(200);
    expect(res.body.address).toContain('Гранитная');
    expect(res.body.minLeadDays).toBe(1);
    expect(res.body.phones).toEqual(['+7 (911) 228-31-92']);
    expect(res.body.locations).toEqual([DEFAULT_LOCATION]);
    expect(res.body.schedule).toHaveLength(7);
    expect(res.body.slots.length).toBeGreaterThan(0);
  });

  it('allows admin to update pickup settings', async () => {
    const admin = await loginAs(app, 'pickup-admin@example.com', UserRole.ADMIN);
    const schedule = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      open: weekday === 1,
      startTime: '10:00',
      endTime: '12:00',
    }));
    const res = await request(app.getHttpServer())
      .put('/api/admin/pickup')
      .set('Cookie', admin.cookie)
      .send({
        minLeadDays: 2,
        phones: ['+7 (911) 228-31-92', '89990001122'],
        locations: [
          DEFAULT_LOCATION,
          { city: 'Москва', address: 'проспект Пушкина' },
        ],
        schedule,
      })
      .expect(200);

    expect(res.body.minLeadDays).toBe(2);
    expect(res.body.phones).toEqual([
      '+7 (911) 228-31-92',
      '+7 (999) 000-11-22',
    ]);
    expect(res.body.locations).toEqual([
      DEFAULT_LOCATION,
      { city: 'Москва', address: 'проспект Пушкина' },
    ]);
    expect(res.body.address).toBe('Санкт-Петербург, Гранитная 51');
    expect(res.body.schedule[1].open).toBe(true);
  });

  it('rejects pickup settings without phones', async () => {
    const admin = await loginAs(app, 'pickup-admin-empty@example.com', UserRole.ADMIN);
    const schedule = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      open: weekday !== 0,
      startTime: '12:00',
      endTime: '14:00',
    }));
    await request(app.getHttpServer())
      .put('/api/admin/pickup')
      .set('Cookie', admin.cookie)
      .send({
        minLeadDays: 1,
        phones: [],
        locations: [DEFAULT_LOCATION],
        schedule,
      })
      .expect(400);
  });

  it('rejects pickup settings without locations', async () => {
    const admin = await loginAs(app, 'pickup-admin-no-loc@example.com', UserRole.ADMIN);
    const schedule = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      open: weekday !== 0,
      startTime: '12:00',
      endTime: '14:00',
    }));
    await request(app.getHttpServer())
      .put('/api/admin/pickup')
      .set('Cookie', admin.cookie)
      .send({
        minLeadDays: 1,
        phones: ['+7 (911) 228-31-92'],
        locations: [],
        schedule,
      })
      .expect(400);
  });

  it('denies staff without PICKUP_MANAGE', async () => {
    const staff = await loginAs(app, 'pickup-staff@example.com', {
      role: UserRole.STAFF,
      permissions: [],
    });
    await request(app.getHttpServer())
      .get('/api/admin/pickup')
      .set('Cookie', staff.cookie)
      .expect(403);
  });
});
