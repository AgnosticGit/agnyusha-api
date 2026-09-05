import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MAIL_SEND, type MailSend } from '../mail/mail.tokens';
import { createRawToken, hashToken } from './auth.crypto';
import type { AuthUser } from './auth.types';

const SESSION_DAYS = 30;
const MIN_REQUEST_INTERVAL_MS = 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(MAIL_SEND) private readonly sendMail: MailSend,
  ) {}

  private magicLinkTtlMs(): number {
    const minutes = Number(
      this.config.get<string>('MAGIC_LINK_EXPIRES_MINUTES') ?? '15',
    );
    const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
    return safe * 60_000;
  }

  private webOrigin(): string {
    const cors = this.config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';
    return cors.split(',')[0]?.trim() || 'http://localhost:3000';
  }

  async requestMagicLink(emailRaw: string): Promise<{ ok: true }> {
    const email = emailRaw.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Укажите email');
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });

    const recent = await this.prisma.magicLink.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - MIN_REQUEST_INTERVAL_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      return { ok: true };
    }

    const rawToken = createRawToken();
    const expiresAt = new Date(Date.now() + this.magicLinkTtlMs());

    await this.prisma.magicLink.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });

    const link = `${this.webOrigin()}/auth/callback?token=${encodeURIComponent(rawToken)}`;
    const minutes = Math.round(this.magicLinkTtlMs() / 60_000);

    await this.sendMail({
      to: email,
      subject: 'Вход в Агнюша',
      text: `Перейдите по ссылке, чтобы войти (действует ${minutes} мин.):\n\n${link}\n\nЕсли вы не запрашивали вход, просто игнорируйте письмо.`,
      html: `<p>Перейдите по ссылке, чтобы войти (действует ${minutes} мин.):</p><p><a href="${link}">Войти в Агнюша</a></p><p>Если вы не запрашивали вход, просто игнорируйте письмо.</p>`,
    });

    return { ok: true };
  }

  async verifyMagicLink(rawToken: string): Promise<{
    sessionToken: string;
    user: AuthUser;
    maxAgeMs: number;
  }> {
    const tokenHash = hashToken(rawToken.trim());
    const magic = await this.prisma.magicLink.findFirst({
      where: { tokenHash, consumedAt: null },
      include: { user: true },
    });

    if (!magic || magic.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Ссылка недействительна или устарела');
    }

    const maxAgeMs = SESSION_DAYS * 24 * 60 * 60 * 1000;
    const sessionToken = createRawToken();
    const expiresAt = new Date(Date.now() + maxAgeMs);

    await this.prisma.$transaction([
      this.prisma.magicLink.update({
        where: { id: magic.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.session.create({
        data: {
          userId: magic.userId,
          tokenHash: hashToken(sessionToken),
          expiresAt,
        },
      }),
    ]);

    return {
      sessionToken,
      user: {
        id: magic.user.id,
        email: magic.user.email,
        role: magic.user.role,
      },
      maxAgeMs,
    };
  }

  async getUserBySessionToken(rawToken: string | undefined) {
    if (!rawToken) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!session || session.expiresAt.getTime() < Date.now()) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    await this.prisma.session.deleteMany({
      where: { tokenHash: hashToken(rawToken) },
    });
  }
}
