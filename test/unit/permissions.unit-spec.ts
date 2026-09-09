import { StaffPermission, UserRole } from '@prisma/client';
import {
  ALL_STAFF_PERMISSIONS,
  PRODUCT_PERMISSIONS,
  STAFF_ROLES,
  canAccessAnalytics,
  canAccessSystemHealth,
  canManageOrders,
  canManageUsers,
  hasAnyProductPermission,
  hasPermission,
  isStaffRole,
} from '../../src/auth/permissions';

describe('permissions', () => {
  describe('constants', () => {
    it('lists staff roles', () => {
      expect(STAFF_ROLES).toEqual([
        UserRole.STAFF,
        UserRole.MANAGER,
        UserRole.ADMIN,
      ]);
    });

    it('lists product and all staff permissions', () => {
      expect(PRODUCT_PERMISSIONS).toEqual([
        StaffPermission.PRODUCT_CREATE,
        StaffPermission.PRODUCT_DELETE,
        StaffPermission.PRODUCT_EDIT,
        StaffPermission.PRODUCT_STOCK,
      ]);
      expect(ALL_STAFF_PERMISSIONS).toEqual([
        ...PRODUCT_PERMISSIONS,
        StaffPermission.ORDER_MANAGE,
      ]);
    });
  });

  describe('isStaffRole', () => {
    it('is true for STAFF/MANAGER/ADMIN and false for USER', () => {
      expect(isStaffRole(UserRole.USER)).toBe(false);
      expect(isStaffRole(UserRole.STAFF)).toBe(true);
      expect(isStaffRole(UserRole.MANAGER)).toBe(true);
      expect(isStaffRole(UserRole.ADMIN)).toBe(true);
    });
  });

  describe('canManageUsers', () => {
    it('allows ADMIN and MANAGER only', () => {
      expect(canManageUsers(UserRole.USER)).toBe(false);
      expect(canManageUsers(UserRole.STAFF)).toBe(false);
      expect(canManageUsers(UserRole.MANAGER)).toBe(true);
      expect(canManageUsers(UserRole.ADMIN)).toBe(true);
    });
  });

  describe('hasPermission', () => {
    it('grants ADMIN every permission regardless of list', () => {
      expect(
        hasPermission(
          { role: UserRole.ADMIN, permissions: [] },
          StaffPermission.ORDER_MANAGE,
        ),
      ).toBe(true);
    });

    it('checks STAFF/MANAGER/USER permission lists', () => {
      expect(
        hasPermission(
          {
            role: UserRole.STAFF,
            permissions: [StaffPermission.PRODUCT_EDIT],
          },
          StaffPermission.PRODUCT_EDIT,
        ),
      ).toBe(true);
      expect(
        hasPermission(
          {
            role: UserRole.STAFF,
            permissions: [StaffPermission.PRODUCT_EDIT],
          },
          StaffPermission.ORDER_MANAGE,
        ),
      ).toBe(false);
      expect(
        hasPermission(
          {
            role: UserRole.MANAGER,
            permissions: [StaffPermission.ORDER_MANAGE],
          },
          StaffPermission.ORDER_MANAGE,
        ),
      ).toBe(true);
      expect(
        hasPermission(
          { role: UserRole.USER, permissions: [] },
          StaffPermission.PRODUCT_CREATE,
        ),
      ).toBe(false);
    });
  });

  describe('hasAnyProductPermission', () => {
    it('is true for ADMIN', () => {
      expect(
        hasAnyProductPermission({ role: UserRole.ADMIN, permissions: [] }),
      ).toBe(true);
    });

    it('is true when any product permission is present', () => {
      expect(
        hasAnyProductPermission({
          role: UserRole.STAFF,
          permissions: [StaffPermission.PRODUCT_STOCK],
        }),
      ).toBe(true);
      expect(
        hasAnyProductPermission({
          role: UserRole.STAFF,
          permissions: [StaffPermission.ORDER_MANAGE],
        }),
      ).toBe(false);
      expect(
        hasAnyProductPermission({ role: UserRole.USER, permissions: [] }),
      ).toBe(false);
    });
  });

  describe('canManageOrders', () => {
    it('requires ORDER_MANAGE (or ADMIN)', () => {
      expect(
        canManageOrders({ role: UserRole.ADMIN, permissions: [] }),
      ).toBe(true);
      expect(
        canManageOrders({
          role: UserRole.STAFF,
          permissions: [StaffPermission.ORDER_MANAGE],
        }),
      ).toBe(true);
      expect(
        canManageOrders({
          role: UserRole.MANAGER,
          permissions: [StaffPermission.PRODUCT_EDIT],
        }),
      ).toBe(false);
    });
  });

  describe('canAccessAnalytics', () => {
    it('allows ADMIN and MANAGER', () => {
      expect(
        canAccessAnalytics({ role: UserRole.ADMIN, permissions: [] }),
      ).toBe(true);
      expect(
        canAccessAnalytics({ role: UserRole.MANAGER, permissions: [] }),
      ).toBe(true);
    });

    it('allows STAFF with any product permission', () => {
      expect(
        canAccessAnalytics({
          role: UserRole.STAFF,
          permissions: [StaffPermission.PRODUCT_CREATE],
        }),
      ).toBe(true);
      expect(
        canAccessAnalytics({
          role: UserRole.STAFF,
          permissions: [StaffPermission.ORDER_MANAGE],
        }),
      ).toBe(false);
      expect(
        canAccessAnalytics({ role: UserRole.USER, permissions: [] }),
      ).toBe(false);
    });
  });

  describe('canAccessSystemHealth', () => {
    it('allows ADMIN only', () => {
      expect(canAccessSystemHealth({ role: UserRole.ADMIN })).toBe(true);
      expect(canAccessSystemHealth({ role: UserRole.MANAGER })).toBe(false);
      expect(canAccessSystemHealth({ role: UserRole.STAFF })).toBe(false);
      expect(canAccessSystemHealth({ role: UserRole.USER })).toBe(false);
    });
  });
});
