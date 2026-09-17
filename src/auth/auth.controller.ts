import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  HttpCode,
  ServiceUnavailableException,
  Logger,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService, GoogleOAuthError } from './auth.service';
import {
  RequestMagicLinkDto,
  PrivacyConsentDto,
  UpdateProfileDto,
  VerifyMagicLinkDto,
} from './dto/auth.dto';
import {
  CART_COOKIE,
  OAUTH_STATE_COOKIE,
  PRIVACY_CONSENT_COOKIE,
  PRIVACY_CONSENT_COOKIE_TTL_MS,
  SESSION_COOKIE,
  clearCookieOptions,
  cookieSameSite,
  cookieSecure,
  createRawToken,
  sessionCookieOptions,
} from './auth.crypto';
import { resolveClientIp } from '../common/client-ip';
import { CartService } from '../cart/cart.service';
import { AuthGuard, type AuthedRequest } from './auth.guard';

/** Avoid Express query parser turning `+` into space (breaks Google auth codes). */
function rawQueryParam(req: Request, name: string): string | undefined {
  const qIndex = req.originalUrl.indexOf('?');
  if (qIndex < 0) return undefined;
  const value = new URLSearchParams(req.originalUrl.slice(qIndex + 1)).get(
    name,
  );
  return value ?? undefined;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly cart: CartService,
  ) {}

  private secureCookies() {
    return cookieSecure(this.config);
  }

  private sameSite() {
    return cookieSameSite(this.config);
  }

  private clearOAuthState(res: Response) {
    res.clearCookie(
      OAUTH_STATE_COOKIE,
      clearCookieOptions(this.secureCookies(), this.sameSite()),
    );
  }

  private clearPrivacyConsentCookie(res: Response) {
    res.clearCookie(
      PRIVACY_CONSENT_COOKIE,
      clearCookieOptions(this.secureCookies(), this.sameSite()),
    );
  }

  @Post('magic-link')
  @HttpCode(200)
  async requestMagicLink(
    @Body() body: RequestMagicLinkDto,
    @Req() req: Request,
  ) {
    return this.auth.requestMagicLink(body.email, {
      clientIp: resolveClientIp(req),
      privacyConsent: body.privacyConsent,
    });
  }

  /** Marks that the user accepted privacy policy before Google OAuth redirect. */
  @Post('privacy-consent')
  @HttpCode(200)
  privacyConsent(
    @Body() body: PrivacyConsentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.cookie(
      PRIVACY_CONSENT_COOKIE,
      '1',
      sessionCookieOptions(
        this.secureCookies(),
        PRIVACY_CONSENT_COOKIE_TTL_MS,
        this.sameSite(),
      ),
    );
    return { ok: true as const };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body() body: VerifyMagicLinkDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyMagicLink(body.token);
    res.cookie(
      SESSION_COOKIE,
      result.sessionToken,
      sessionCookieOptions(
        this.secureCookies(),
        result.maxAgeMs,
        this.sameSite(),
      ),
    );
    this.clearPrivacyConsentCookie(res);
    const cart = await this.cart.mergeGuestIntoUser(
      result.user.id,
      req.cookies?.[CART_COOKIE],
      res,
    );
    return { user: result.user, cart };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.auth.getUserBySessionToken(
      req.cookies?.[SESSION_COOKIE],
    );
    return { user };
  }

  @Patch('profile')
  @UseGuards(AuthGuard)
  async updateProfile(
    @Req() req: AuthedRequest,
    @Body() body: UpdateProfileDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException();
    }
    const user = await this.auth.updateProfile(req.user.id, body);
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(
      SESSION_COOKIE,
      clearCookieOptions(this.secureCookies(), this.sameSite()),
    );
    return { ok: true };
  }

  @Get('google')
  googleStart(@Req() req: Request, @Res() res: Response) {
    if (!this.auth.isGoogleConfigured()) {
      throw new ServiceUnavailableException('Вход через Google не настроен');
    }
    if (req.cookies?.[PRIVACY_CONSENT_COOKIE] !== '1') {
      const web = this.auth.webOrigin();
      return res.redirect(
        `${web}/auth/callback?error=${encodeURIComponent('privacy_consent')}`,
      );
    }
    const state = createRawToken(24);
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.sameSite() === 'none' ? true : this.secureCookies(),
      sameSite: this.sameSite(),
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
      this.clearPrivacyConsentCookie(res);
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
      string | undefined;
    if (!state || !expectedState || state !== expectedState) {
      return fail('invalid_state');
    }
    if (!code) {
      return fail('missing_code');
    }

    try {
      const privacyConsent = req.cookies?.[PRIVACY_CONSENT_COOKIE] === '1';
      const result = await this.auth.loginWithGoogleCode(code, {
        privacyConsent,
      });
      this.clearOAuthState(res);
      this.clearPrivacyConsentCookie(res);
      res.cookie(
        SESSION_COOKIE,
        result.sessionToken,
        sessionCookieOptions(
          this.secureCookies(),
          result.maxAgeMs,
          this.sameSite(),
        ),
      );
      await this.cart.mergeGuestIntoUser(
        result.user.id,
        req.cookies?.[CART_COOKIE],
        res,
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
