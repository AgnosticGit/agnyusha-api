import type { StaffPermission, UserRole } from '@prisma/client';

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  permissions: StaffPermission[];
};
