import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService, GoogleOAuthError } from './auth.service';
import { RequestMagicLinkDto, VerifyMagicLinkDto } from './dto/auth.dto';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  clearCookieOptions,
  cookieSecure,
  createRawToken,
  sessionCookieOptions,
} from './auth.crypto';

/** Avoid Express query parser turning `+` into space (breaks Google auth codes). */
function rawQueryParam(req: Request, name: string): string | undefined {
  const qIndex = req.originalUrl.indexOf('?');
  if (qIndex < 0) return undefined;
  const value = new URLSearchParams(req.originalUrl.slice(qIndex + 1)).get(
    name,
  );
  return value ?? undefined;
}

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private secureCookies() {
    return cookieSecure(this.config);
  }

  private clearOAuthState(res: Response) {
    res.clearCookie(OAUTH_STATE_COOKIE, clearCookieOptions(this.secureCookies()));
  }

  @Post('magic-link')
  @HttpCode(200)
  async requestMagicLink(
    @Body() body: RequestMagicLinkDto,
    @Req() req: Request,
  ) {
    return this.auth.requestMagicLink(body.email, clientIp(req));
  }

  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body() body: VerifyMagicLinkDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyMagicLink(body.token);
    res.cookie(
      SESSION_COOKIE,
      result.sessionToken,
      sessionCookieOptions(this.secureCookies(), result.maxAgeMs),
    );
    return { user: result.user };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, clearCookieOptions(this.secureCookies()));
    return { ok: true };
  }

  @Get('google')
  googleStart(@Res() res: Response) {
    if (!this.auth.isGoogleConfigured()) {
      throw new ServiceUnavailableException('Вход через Google не настроен');
    }
    const state = createRawToken(24);
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.secureCookies(),
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    return res.redirect(this.auth.buildGoogleAuthUrl(state));
  }

  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const web = this.auth.webOrigin();
    const fail = (reason: string) => {
      this.clearOAuthState(res);
      return res.redirect(
        `${web}/auth/callback?error=${encodeURIComponent(reason)}`,
      );
    };

    const code = rawQueryParam(req, 'code');
    const state = rawQueryParam(req, 'state');
    const oauthError = rawQueryParam(req, 'error');

    if (oauthError) {
      return fail('google_denied');
    }

    const expectedState = req.cookies?.[OAUTH_STATE_COOKIE] as
      | string
      | undefined;
    if (!state || !expectedState || state !== expectedState) {
      return fail('invalid_state');
    }
    if (!code) {
      return fail('missing_code');
    }

    try {
      const result = await this.auth.loginWithGoogleCode(code);
      this.clearOAuthState(res);
      res.cookie(
        SESSION_COOKIE,
        result.sessionToken,
        sessionCookieOptions(this.secureCookies(), result.maxAgeMs),
      );
      return res.redirect(`${web}/`);
    } catch (err) {
      const reason =
        err instanceof GoogleOAuthError ? err.reason : 'google_failed';
      this.logger.warn(
        `Google OAuth callback failed (${reason}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fail(reason);
    }
  }
}
