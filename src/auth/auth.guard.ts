import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { SESSION_COOKIE } from './auth.crypto';
import type { AuthUser } from './auth.types';

export type AuthedRequest = Request & { user?: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    if (!user) throw new UnauthorizedException('Нужна авторизация');
    req.user = user;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    if (!user) throw new UnauthorizedException('Нужна авторизация');
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Недостаточно прав');
    }
    req.user = user;
    return true;
  }
}
