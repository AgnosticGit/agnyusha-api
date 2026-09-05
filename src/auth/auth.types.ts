import type { UserRole } from '@prisma/client';

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};
