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
  canAccessSystemHealth,
  canManageOrders,
  canManageUsers,
  hasAnyProductPermission,
  hasPermission,
  isStaffRole,
} from './permissions';

export type AuthedRequest = Request & { user?: AuthUser };

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: StaffPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

async function loadOptionalUser(
  auth: AuthService,
  req: AuthedRequest,
): Promise<AuthUser | null> {
  const user = await auth.getUserBySessionToken(req.cookies?.[SESSION_COOKIE]);
  if (user) req.user = user;
  return user;
}

async function requireUser(
  auth: AuthService,
  req: AuthedRequest,
): Promise<AuthUser> {
  const user = await loadOptionalUser(auth, req);
  if (!user) throw new UnauthorizedException('Нужна авторизация');
  return user;
}

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    await loadOptionalUser(this.auth, req);
    return true;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    await requireUser(this.auth, req);
    return true;
  }
}

/** ADMIN or USER_MANAGE — people management. */
@Injectable()
export class ManageUsersGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await requireUser(this.auth, req);
    if (!canManageUsers(user)) {
      throw new ForbiddenException('Недостаточно прав');
    }
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
    const user = await requireUser(this.auth, req);

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
    const user = await requireUser(this.auth, req);
    if (!hasAnyProductPermission(user)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}

@Injectable()
export class AnalyticsAccessGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await requireUser(this.auth, req);
    if (!canAccessAnalytics(user)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}

/** ADMIN always; otherwise ORDER_MANAGE. */
@Injectable()
export class OrdersAccessGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await requireUser(this.auth, req);
    if (!canManageOrders(user)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}

/** System health monitoring — ADMIN only. */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await requireUser(this.auth, req);
    if (!canAccessSystemHealth(user)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}
