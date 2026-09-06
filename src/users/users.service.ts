import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ROOT_ADMIN_EMAIL = 'agnostex@gmail.com';

const userSelect = {
  id: true,
  email: true,
  role: true,
  bannedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: { q?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const q = params.q?.trim();

    const where: Prisma.UserWhereInput = q
      ? { email: { contains: q, mode: 'insensitive' } }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: userSelect,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async setRole(actorId: string, userId: string, role: UserRole) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    if (target.email === ROOT_ADMIN_EMAIL && role !== UserRole.ADMIN) {
      throw new ForbiddenException('Нельзя снять роль главного админа');
    }

    if (target.id === actorId && role !== UserRole.ADMIN) {
      throw new ForbiddenException('Нельзя снять админку с самого себя');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: userSelect,
    });
  }

  async setBanned(actorId: string, userId: string, banned: boolean) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    if (target.email === ROOT_ADMIN_EMAIL) {
      throw new ForbiddenException('Нельзя забанить главного админа');
    }

    if (target.id === actorId) {
      throw new ForbiddenException('Нельзя забанить самого себя');
    }

    const bannedAt = banned ? new Date() : null;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { bannedAt },
      select: userSelect,
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

    return user;
  }

  async remove(actorId: string, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    if (target.email === ROOT_ADMIN_EMAIL) {
      throw new ForbiddenException('Нельзя удалить главного админа');
    }

    if (target.id === actorId) {
      throw new ForbiddenException('Нельзя удалить самого себя');
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true as const };
  }
}
