import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffPermission, UserRole } from '@prisma/client';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { SESSION_COOKIE } from './auth.crypto';
import type { AuthUser } from './auth.types';
import {
  canAccessAnalytics,
  canManageUsers,
  hasAnyProductPermission,
  hasPermission,
  isStaffRole,
} from './permissions';

export type AuthedRequest = Request & { user?: AuthUser };

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: StaffPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    if (user) req.user = user;
    return true;
  }
}

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

/** Full superuser only. */
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

/** Any staff member (STAFF / MANAGER / ADMIN). */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    if (!user) throw new UnauthorizedException('Нужна авторизация');
    if (!isStaffRole(user.role)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    req.user = user;
    return true;
  }
}

/** ADMIN or MANAGER — people management. */
@Injectable()
export class ManageUsersGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    if (!user) throw new UnauthorizedException('Нужна авторизация');
    if (!canManageUsers(user.role)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    req.user = user;
    return true;
  }
}

/** ADMIN always; otherwise require listed permissions (any match). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    if (!user) throw new UnauthorizedException('Нужна авторизация');
    req.user = user;

    if (user.role === UserRole.ADMIN) return true;

    const required =
      this.reflector.getAllAndOverride<StaffPermission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (!required.length) {
      if (!isStaffRole(user.role)) {
        throw new ForbiddenException('Недостаточно прав');
      }
      return true;
    }

    const ok = required.some((p) => hasPermission(user, p));
    if (!ok) throw new ForbiddenException('Недостаточно прав');
    return true;
  }
}

@Injectable()
export class ProductsAccessGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    if (!user) throw new UnauthorizedException('Нужна авторизация');
    if (!hasAnyProductPermission(user)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    req.user = user;
    return true;
  }
}

@Injectable()
export class AnalyticsAccessGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    if (!user) throw new UnauthorizedException('Нужна авторизация');
    if (!canAccessAnalytics(user)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    req.user = user;
    return true;
  }
}
