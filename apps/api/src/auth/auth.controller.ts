import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { loginSchema, registerSchema, sendCodeSchema } from '@novel/contracts';
import type { Request, Response } from 'express';
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS } from './auth.constants';
import { SessionAuthGuard } from './session-auth.guard';
import { AuthService } from './auth.service';
import { authError } from './auth.errors';
import type { AuthenticatedRequest } from './auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('send-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a registration verification code' })
  async sendCode(@Body() body: unknown, @Req() request: Request) {
    const parsed = sendCodeSchema.safeParse(body);
    if (!parsed.success) {
      throw authError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter a valid email address',
        parsed.error.flatten(),
      );
    }

    return this.authService.sendRegistrationCode(
      parsed.data.email,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
  }

  @Post('register')
  @ApiOperation({ summary: 'Register with an emailed verification code' })
  async register(@Body() body: unknown) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw authError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter a valid email, verification code, and password',
        parsed.error.flatten(),
      );
    }

    return this.authService.register(parsed.data.email, parsed.data.code, parsed.data.password);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw authError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter a valid email and password',
        parsed.error.flatten(),
      );
    }

    const result = await this.authService.login(
      parsed.data.email,
      parsed.data.password,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      request.get('user-agent'),
    );
    this.setSessionCookie(response, result.token);
    return result.user;
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Return the signed-in user' })
  me(@Req() request: AuthenticatedRequest) {
    return request.auth?.user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (request.auth) {
      await this.authService.logout(request.auth.sessionId);
    }
    this.clearSessionCookie(response);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Revoke every session for the signed-in user' })
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (request.auth) {
      await this.authService.logoutAll(request.auth.user.id);
    }
    this.clearSessionCookie(response);
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  private clearSessionCookie(response: Response): void {
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      path: '/',
    });
  }
}
