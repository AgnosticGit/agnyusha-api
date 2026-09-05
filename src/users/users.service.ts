import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ROOT_ADMIN_EMAIL = 'agnostex@gmail.com';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });
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
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });
  }
}
