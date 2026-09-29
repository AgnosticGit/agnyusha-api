export const SUPER_ADMIN_EMAIL = 'agnostex@gmail.com';

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}
