import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createTestApp } from './helpers/cdek-test.helpers';
import { loginAs } from './helpers/login-as';
import { PrismaService } from '../src/prisma/prisma.service';

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
        schedule: [
          { weekday: 0, open: false, startTime: '12:00', endTime: '14:00' },
          { weekday: 1, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 2, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 3, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 4, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 5, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 6, open: true, startTime: '12:00', endTime: '14:00' },
        ],
      },
      update: {
        address: 'Санкт-Петербург, Гранитная 51',
        minLeadDays: 1,
        schedule: [
          { weekday: 0, open: false, startTime: '12:00', endTime: '14:00' },
          { weekday: 1, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 2, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 3, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 4, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 5, open: true, startTime: '12:00', endTime: '14:00' },
          { weekday: 6, open: true, startTime: '12:00', endTime: '14:00' },
        ],
      },
    });
    await app.close();
  });

  it('returns default public pickup settings and slots', async () => {
    const res = await request(app.getHttpServer()).get('/api/pickup').expect(200);
    expect(res.body.address).toContain('Гранитная');
    expect(res.body.minLeadDays).toBe(1);
    expect(res.body.schedule).toHaveLength(7);
    expect(res.body.schedule[0].open).toBe(false);
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
        address: 'СПб, Новый адрес 2',
        minLeadDays: 2,
        schedule,
      })
      .expect(200);

    expect(res.body.address).toBe('СПб, Новый адрес 2');
    expect(res.body.minLeadDays).toBe(2);
    expect(res.body.schedule[1].open).toBe(true);
    expect(res.body.schedule[1].startTime).toBe('10:00');
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
