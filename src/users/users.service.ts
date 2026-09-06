import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StaffPermission,
  UserRole,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_STAFF_PERMISSIONS } from '../auth/permissions';

const ROOT_ADMIN_EMAIL = 'agnostex@gmail.com';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private async mapUser(user: {
    id: string;
    email: string;
    role: UserRole;
    bannedAt: Date | null;
    createdAt: Date;
  }) {
    const permissions =
      user.role === UserRole.USER || user.role === UserRole.ADMIN
        ? []
        : (
            await this.prisma.userPermission.findMany({
              where: { userId: user.id },
              select: { permission: true },
            })
          ).map((p) => p.permission);

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      bannedAt: user.bannedAt,
      createdAt: user.createdAt,
      permissions,
    };
  }

  async list(params: {
    q?: string;
    page?: number;
    limit?: number;
    category?: 'clients' | 'staff';
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const q = params.q?.trim();

    const where: Prisma.UserWhereInput = {};
    if (q) {
      where.email = { contains: q, mode: 'insensitive' };
    }
    if (params.category === 'clients') {
      where.role = UserRole.USER;
    } else if (params.category === 'staff') {
      where.role = { in: [UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN] };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const items = await Promise.all(rows.map((u) => this.mapUser(u)));
    return { items, total, page, limit };
  }

  async setRole(
    actorId: string,
    actorRole: UserRole,
    userId: string,
    role: UserRole,
    permissions?: StaffPermission[],
  ) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    if (target.email === ROOT_ADMIN_EMAIL && role !== UserRole.ADMIN) {
      throw new ForbiddenException('Нельзя снять роль главного админа');
    }

    if (target.id === actorId && role !== target.role && target.role === UserRole.ADMIN) {
      throw new ForbiddenException('Нельзя снять админку с самого себя');
    }

    if (actorRole !== UserRole.ADMIN) {
      if (role === UserRole.ADMIN) {
        throw new ForbiddenException('Нельзя назначить роль администратора');
      }
      if (target.role === UserRole.ADMIN) {
        throw new ForbiddenException('Нельзя изменять администратора');
      }
    }

    const nextPermissions =
      role === UserRole.STAFF || role === UserRole.MANAGER
        ? [
            ...new Set(
              (permissions ?? []).filter((p) =>
                ALL_STAFF_PERMISSIONS.includes(p),
              ),
            ),
          ]
        : [];

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { role },
      });
      await tx.userPermission.deleteMany({ where: { userId } });
      if (nextPermissions.length) {
        await tx.userPermission.createMany({
          data: nextPermissions.map((permission) => ({ userId, permission })),
        });
      }
    });

    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return this.mapUser(updated);
  }

  async setBanned(actorId: string, actorRole: UserRole, userId: string, banned: boolean) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    if (target.email === ROOT_ADMIN_EMAIL) {
      throw new ForbiddenException('Нельзя забанить главного админа');
    }

    if (target.id === actorId) {
      throw new ForbiddenException('Нельзя забанить самого себя');
    }

    if (actorRole !== UserRole.ADMIN && target.role === UserRole.ADMIN) {
      throw new ForbiddenException('Нельзя забанить администратора');
    }

    const bannedAt = banned ? new Date() : null;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { bannedAt },
    });

    if (banned) {
      await this.prisma.$transaction([
        this.prisma.session.deleteMany({ where: { userId } }),
        this.prisma.magicLink.updateMany({
          where: { userId, consumedAt: null },
          data: { consumedAt: new Date() },
        }),
      ]);
    }

    return this.mapUser(user);
  }

  async remove(actorId: string, actorRole: UserRole, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    if (target.email === ROOT_ADMIN_EMAIL) {
      throw new ForbiddenException('Нельзя удалить главного админа');
    }

    if (target.id === actorId) {
      throw new ForbiddenException('Нельзя удалить самого себя');
    }

    if (actorRole !== UserRole.ADMIN && target.role === UserRole.ADMIN) {
      throw new ForbiddenException('Нельзя удалить администратора');
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true as const };
  }
}
