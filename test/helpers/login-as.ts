import type { INestApplication } from '@nestjs/common';
import { StaffPermission, UserRole } from '@prisma/client';
import {
  createRawToken,
  hashToken,
  SESSION_COOKIE,
} from '../../src/auth/auth.crypto';
import { PrismaService } from '../../src/prisma/prisma.service';

export type LoginAsOptions = {
  role?: UserRole;
  permissions?: StaffPermission[];
  /** Defaults to now (activated). Pass null for unverified users. */
  emailVerifiedAt?: Date | null;
};

/** Shared session bootstrap for API e2e specs. */
export async function loginAs(
  app: INestApplication,
  email: string,
  options: LoginAsOptions | UserRole = UserRole.USER,
) {
  const opts: LoginAsOptions =
    typeof options === 'string' ? { role: options } : options;
  const role = opts.role ?? UserRole.USER;
  const emailVerifiedAt =
    opts.emailVerifiedAt === undefined ? new Date() : opts.emailVerifiedAt;
  const permissions = opts.permissions ?? [];

  const prisma = app.get(PrismaService);
  const privacyConsentAt = new Date();
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, role, emailVerifiedAt, privacyConsentAt },
    update: { role, emailVerifiedAt, privacyConsentAt },
  });

  await prisma.userPermission.deleteMany({ where: { userId: user.id } });
  if (permissions.length) {
    await prisma.userPermission.createMany({
      data: permissions.map((permission) => ({
        userId: user.id,
        permission,
      })),
    });
  }

  const raw = createRawToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${raw}` };
}
