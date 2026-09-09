import type { StaffPermission, UserRole } from '@prisma/client';

export type AuthUser = {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  phone: string;
  lastName: string;
  firstName: string;
  middleName: string;
  role: UserRole;
  permissions: StaffPermission[];
};
