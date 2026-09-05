import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RequestMagicLinkDto, VerifyMagicLinkDto } from './dto/auth.dto';
import { SESSION_COOKIE, sessionCookieOptions } from './auth.crypto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private isProd() {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  @Post('magic-link')
  @HttpCode(200)
  async requestMagicLink(@Body() body: RequestMagicLinkDto) {
    return this.auth.requestMagicLink(body.email);
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
      sessionCookieOptions(this.isProd(), result.maxAgeMs),
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
    res.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProd(),
    });
    return { ok: true };
  }
}
