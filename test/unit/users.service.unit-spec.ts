import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from '../../src/users/users.service';

describe('UsersService activation gate', () => {
  function makeService(target: {
    id: string;
    email: string;
    role: UserRole;
    emailVerifiedAt: Date | null;
  }) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(target),
        findUniqueOrThrow: jest.fn().mockResolvedValue(target),
      },
      userPermission: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          user: {
            update: jest.fn().mockResolvedValue(target),
          },
          userPermission: {
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
        };
        return fn(tx);
      }),
    };
    return {
      service: new UsersService(prisma as never),
      prisma,
    };
  }

  it('blocks setRole for unverified users', async () => {
    const { service } = makeService({
      id: 'u1',
      email: 'x@example.com',
      role: UserRole.USER,
      emailVerifiedAt: null,
    });
    await expect(
      service.setRole('admin', UserRole.ADMIN, 'u1', UserRole.STAFF, []),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks setBanned for unverified users', async () => {
    const { service } = makeService({
      id: 'u1',
      email: 'x@example.com',
      role: UserRole.USER,
      emailVerifiedAt: null,
    });
    await expect(
      service.setBanned('admin', UserRole.ADMIN, 'u1', true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows remove for unverified users', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'x@example.com',
          role: UserRole.USER,
          emailVerifiedAt: null,
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new UsersService(prisma as never);
    await expect(service.remove('admin', UserRole.ADMIN, 'u1')).resolves.toEqual(
      { ok: true },
    );
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('throws NotFound when target missing on setRole', async () => {
    const { service, prisma } = makeService({
      id: 'u1',
      email: 'x@example.com',
      role: UserRole.USER,
      emailVerifiedAt: new Date(),
    });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.setRole('admin', UserRole.ADMIN, 'missing', UserRole.STAFF),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
