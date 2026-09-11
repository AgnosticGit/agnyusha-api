import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolvePublicWebUrl } from '../common/web-origin';
import { PrismaService } from '../prisma/prisma.service';
import { MAIL_SEND, type MailSend } from '../mail/mail.tokens';
import { createRawToken, hashToken } from './auth.crypto';
import { GOOGLE_FETCH, type GoogleFetch } from './google.tokens';
import type { AuthUser } from './auth.types';
import { SlidingWindowRateLimiter } from '../common/rate-limit';

const SESSION_DAYS = 30;
const MIN_REQUEST_INTERVAL_MS = 60_000;
/** Max magic-link requests per IP per minute (abuse / email bombing). */
const MAGIC_LINK_IP_LIMIT = Number(
  process.env.MAGIC_LINK_IP_LIMIT ??
    (process.env.NODE_ENV === 'test' ? '200' : '20'),
);
const MAGIC_LINK_IP_WINDOW_MS = 60_000;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  error?: string;
  error_description?: string;
};

export class GoogleOAuthError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly magicLinkIpLimiter = new SlidingWindowRateLimiter(
    MAGIC_LINK_IP_LIMIT,
    MAGIC_LINK_IP_WINDOW_MS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(MAIL_SEND) private readonly sendMail: MailSend,
    @Inject(GOOGLE_FETCH) private readonly googleFetch: GoogleFetch,
  ) {}

  private magicLinkTtlMs(): number {
    const minutes = Number(
      this.config.get<string>('MAGIC_LINK_EXPIRES_MINUTES') ?? '15',
    );
    const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
    return safe * 60_000;
  }

  webOrigin(): string {
    return resolvePublicWebUrl(this.config);
  }

  private googleConfig() {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')?.trim() ?? '';
    const clientSecret =
      this.config.get<string>('GOOGLE_CLIENT_SECRET')?.trim() ?? '';
    const callbackUrl =
      this.config.get<string>('GOOGLE_CALLBACK_URL')?.trim() ?? '';
    if (!clientId || !clientSecret || !callbackUrl) return null;
    return { clientId, clientSecret, callbackUrl };
  }

  isGoogleConfigured(): boolean {
    return this.googleConfig() !== null;
  }

  buildGoogleAuthUrl(state: string): string {
    const cfg = this.googleConfig();
    if (!cfg) {
      throw new ServiceUnavailableException('Вход через Google не настроен');
    }
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', cfg.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  private async readGoogleJson<T extends object>(
    res: globalThis.Response,
    step: string,
  ): Promise<T> {
    const text = await res.text();
    if (!text) {
      throw new GoogleOAuthError(
        'google_failed',
        `Google ${step}: empty body (${res.status})`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GoogleOAuthError(
        'google_failed',
        `Google ${step}: invalid JSON (${res.status})`,
      );
    }
  }

  private async permissionsForUser(userId: string) {
    const rows = await this.prisma.userPermission.findMany({
      where: { userId },
      select: { permission: true },
    });
    return rows.map((r) => r.permission);
  }

  private async toAuthUser(user: {
    id: string;
    email: string;
    emailVerifiedAt?: Date | null;
    phone?: string | null;
    lastName?: string | null;
    firstName?: string | null;
    role: AuthUser['role'];
  }): Promise<AuthUser> {
    return {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      phone: user.phone ?? '',
      lastName: user.lastName ?? '',
      firstName: user.firstName ?? '',
      role: user.role,
      permissions: await this.permissionsForUser(user.id),
    };
  }

  private async createSessionForUser(user: {
    id: string;
    email: string;
    role: AuthUser['role'];
    bannedAt?: Date | null;
  }): Promise<{
    sessionToken: string;
    user: AuthUser;
    maxAgeMs: number;
  }> {
    if (user.bannedAt) {
      throw new ForbiddenException('Аккаунт заблокирован');
    }

    const maxAgeMs = SESSION_DAYS * 24 * 60 * 60 * 1000;
    const sessionToken = createRawToken();
    const expiresAt = new Date(Date.now() + maxAgeMs);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: user.id, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      }),
      this.prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(sessionToken),
          expiresAt,
        },
      }),
    ]);

    return {
      sessionToken,
      user: await this.toAuthUser(
        await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      ),
      maxAgeMs,
    };
  }

  async requestMagicLink(
    emailRaw: string,
    clientIp = 'unknown',
  ): Promise<{ ok: true }> {
    if (!this.magicLinkIpLimiter.tryConsume(clientIp || 'unknown')) {
      throw new HttpException(
        'Слишком много запросов. Попробуйте позже.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const email = emailRaw.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Укажите email');
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });

    // Don't reveal ban status; silently no-op for banned accounts.
    if (user.bannedAt) {
      return { ok: true };
    }

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
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.magicLink.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.magicLink.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
      }),
    ]);

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
    const now = new Date();

    const consumed = await this.prisma.magicLink.updateMany({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });

    if (consumed.count !== 1) {
      throw new UnauthorizedException('Ссылка недействительна или устарела');
    }

    const magic = await this.prisma.magicLink.findFirst({
      where: { tokenHash },
      include: { user: true },
    });
    if (!magic) {
      throw new UnauthorizedException('Ссылка недействительна или устарела');
    }

    await this.prisma.magicLink.updateMany({
      where: { userId: magic.userId, consumedAt: null },
      data: { consumedAt: now },
    });

    return this.createSessionForUser(magic.user);
  }

  async loginWithGoogleCode(code: string): Promise<{
    sessionToken: string;
    user: AuthUser;
    maxAgeMs: number;
  }> {
    const cfg = this.googleConfig();
    if (!cfg) {
      throw new ServiceUnavailableException('Вход через Google не настроен');
    }
    const trimmed = code.trim();
    if (!trimmed) {
      throw new BadRequestException('Код авторизации не получен');
    }

    const tokenBody = new URLSearchParams({
      code: trimmed,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.callbackUrl,
      grant_type: 'authorization_code',
    });

    const tokenRes = await this.googleFetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
      cache: 'no-store',
    });

    const tokenJson = await this.readGoogleJson<GoogleTokenResponse>(
      tokenRes,
      'token',
    );
    if (!tokenRes.ok || !tokenJson.access_token) {
      this.logger.warn(
        `Google token error: ${tokenJson.error ?? tokenRes.status} ${tokenJson.error_description ?? ''}`.trim(),
      );
      throw new GoogleOAuthError(
        tokenJson.error === 'redirect_uri_mismatch'
          ? 'google_redirect'
          : 'google_token',
        tokenJson.error_description ||
          tokenJson.error ||
          'Не удалось обменять код Google',
      );
    }

    const profileRes = await this.googleFetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    const profile = await this.readGoogleJson<GoogleUserInfo>(
      profileRes,
      'userinfo',
    );
    if (!profileRes.ok) {
      this.logger.warn(
        `Google userinfo error: ${profile.error ?? profileRes.status} ${profile.error_description ?? ''}`.trim(),
      );
      throw new GoogleOAuthError(
        'google_profile',
        profile.error_description ||
          profile.error ||
          'Не удалось получить профиль Google',
      );
    }

    const email = String(profile.email ?? '')
      .trim()
      .toLowerCase();
    const verified =
      profile.email_verified === true || profile.email_verified === 'true';
    if (!email || !verified) {
      throw new GoogleOAuthError(
        'google_email',
        'Google-аккаунт без подтверждённого email',
      );
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      create: { email, emailVerifiedAt: new Date() },
      update: {
        emailVerifiedAt: { set: new Date() },
      },
    });

    return this.createSessionForUser(user);
  }

  async getUserBySessionToken(rawToken: string | undefined) {
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.session.deleteMany({ where: { tokenHash } });
      return null;
    }
    if (session.user.bannedAt) {
      await this.prisma.session.deleteMany({
        where: { userId: session.userId },
      });
      return null;
    }
    return this.toAuthUser(session.user);
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    await this.prisma.session.deleteMany({
      where: { tokenHash: hashToken(rawToken) },
    });
  }

  async updateProfile(
    userId: string,
    dto: {
      phone: string;
      lastName: string;
      firstName: string;
    },
  ): Promise<AuthUser> {
    const lastName = dto.lastName.trim();
    const firstName = dto.firstName.trim();
    const phone = dto.phone.trim();
    if (!lastName || !firstName) {
      throw new BadRequestException('Укажите фамилию и имя');
    }
    if (phone.replace(/\D/g, '').length < 11) {
      throw new BadRequestException('Укажите корректный телефон');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        lastName,
        firstName,
        phone,
      },
    });
    return this.toAuthUser(user);
  }
}
