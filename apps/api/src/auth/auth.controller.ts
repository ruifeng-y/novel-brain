import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  recoverAccountSchema,
  registerSchema,
  resetPasswordSchema,
  sendCodeSchema,
} from '@novel/contracts';
import type { Request, Response } from 'express';
import { SESSION_COOKIE_NAME } from './auth.constants';
import { clearSessionCookieOptions, createSessionCookieOptions } from './session-cookie';
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
      await this.authService.logout(
        request.auth.sessionId,
        request.auth.user.id,
        request.ip ?? request.socket.remoteAddress ?? null,
        request.get('user-agent') ?? null,
      );
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
      await this.authService.logoutAll(
        request.auth.user.id,
        request.ip ?? request.socket.remoteAddress ?? null,
        request.get('user-agent') ?? null,
      );
    }
    this.clearSessionCookie(response);
  }

  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Change the signed-in author password' })
  async changePassword(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw authError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter your current password and a new password of at least 8 characters',
        parsed.error.flatten(),
      );
    }

    if (!request.auth) {
      throw authError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }

    await this.authService.changePassword(
      request.auth.user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
    this.clearSessionCookie(response);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a password reset link when the account exists' })
  async forgotPassword(@Body() body: unknown, @Req() request: Request) {
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw authError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter a valid email address',
        parsed.error.flatten(),
      );
    }

    await this.authService.forgotPassword(
      parsed.data.email,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
    return { accepted: true };
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset a password with a one-time email token' })
  async resetPassword(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw authError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter a valid reset link and a new password of at least 8 characters',
        parsed.error.flatten(),
      );
    }

    await this.authService.resetPassword(
      parsed.data.token,
      parsed.data.newPassword,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
    this.clearSessionCookie(response);
  }

  @Post('recover')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Recover an account during its deletion grace period' })
  async recoverAccount(@Body() body: unknown, @Req() request: Request): Promise<void> {
    const parsed = recoverAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw authError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter the account email and password',
        parsed.error.flatten(),
      );
    }
    await this.authService.recoverAccount(
      parsed.data.email,
      parsed.data.password,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      request.get('user-agent') ?? null,
    );
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie(
      SESSION_COOKIE_NAME,
      token,
      createSessionCookieOptions(this.config.get<boolean>('COOKIE_SECURE') === true),
    );
  }

  private clearSessionCookie(response: Response): void {
    response.clearCookie(
      SESSION_COOKIE_NAME,
      clearSessionCookieOptions(this.config.get<boolean>('COOKIE_SECURE') === true),
    );
  }
}
