import { isSuperAdminEmail } from '../../src/auth/super-admin';

describe('isSuperAdminEmail', () => {
  it('matches the store owner regardless of case', () => {
    expect(isSuperAdminEmail('agnostex@gmail.com')).toBe(true);
    expect(isSuperAdminEmail('  Agnostex@Gmail.com ')).toBe(true);
    expect(isSuperAdminEmail('other@gmail.com')).toBe(false);
    expect(isSuperAdminEmail(null)).toBe(false);
  });
});
