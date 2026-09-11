import { StaffPermission, UserRole } from '@prisma/client';
import type { AuthUser } from './auth.types';

export const STAFF_ROLES: UserRole[] = [UserRole.STAFF, UserRole.ADMIN];

export const PRODUCT_PERMISSIONS: StaffPermission[] = [
  StaffPermission.PRODUCT_CREATE,
  StaffPermission.PRODUCT_DELETE,
  StaffPermission.PRODUCT_EDIT,
  StaffPermission.PRODUCT_STOCK,
];

export const ALL_STAFF_PERMISSIONS: StaffPermission[] = [
  ...PRODUCT_PERMISSIONS,
  StaffPermission.ORDER_MANAGE,
  StaffPermission.USER_MANAGE,
  StaffPermission.ANALYTICS_VIEW,
];

export function isStaffRole(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
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

/** ADMIN always; otherwise USER_MANAGE. */
export function canManageUsers(
  user: Pick<AuthUser, 'role' | 'permissions'>,
): boolean {
  return hasPermission(user, StaffPermission.USER_MANAGE);
}

export function canManageOrders(
  user: Pick<AuthUser, 'role' | 'permissions'>,
): boolean {
  return hasPermission(user, StaffPermission.ORDER_MANAGE);
}

/** ADMIN always; otherwise ANALYTICS_VIEW. */
export function canAccessAnalytics(
  user: Pick<AuthUser, 'role' | 'permissions'>,
): boolean {
  return hasPermission(user, StaffPermission.ANALYTICS_VIEW);
}

/** System health / ops monitoring — ADMIN only. */
export function canAccessSystemHealth(user: Pick<AuthUser, 'role'>): boolean {
  return user.role === UserRole.ADMIN;
}
