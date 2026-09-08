import { StaffPermission, UserRole } from '@prisma/client';
import type { AuthUser } from './auth.types';

export const STAFF_ROLES: UserRole[] = [
  UserRole.STAFF,
  UserRole.MANAGER,
  UserRole.ADMIN,
];

export const PRODUCT_PERMISSIONS: StaffPermission[] = [
  StaffPermission.PRODUCT_CREATE,
  StaffPermission.PRODUCT_DELETE,
  StaffPermission.PRODUCT_EDIT,
  StaffPermission.PRODUCT_STOCK,
];

export const ALL_STAFF_PERMISSIONS: StaffPermission[] = [
  ...PRODUCT_PERMISSIONS,
  StaffPermission.ORDER_MANAGE,
];

export function isStaffRole(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

export function canManageUsers(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}

export function hasPermission(
  user: Pick<AuthUser, 'role' | 'permissions'>,
  permission: StaffPermission,
): boolean {
  if (user.role === UserRole.ADMIN) return true;
  return user.permissions.includes(permission);
}

export function hasAnyProductPermission(
  user: Pick<AuthUser, 'role' | 'permissions'>,
): boolean {
  if (user.role === UserRole.ADMIN) return true;
  return user.permissions.some((p) => PRODUCT_PERMISSIONS.includes(p));
}

export function canManageOrders(
  user: Pick<AuthUser, 'role' | 'permissions'>,
): boolean {
  return hasPermission(user, StaffPermission.ORDER_MANAGE);
}

export function canAccessAnalytics(
  user: Pick<AuthUser, 'role' | 'permissions'>,
): boolean {
  if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
    return true;
  }
  return hasAnyProductPermission(user);
}
