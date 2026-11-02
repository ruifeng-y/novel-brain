import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  emailChangeRequestSchema,
  emailChangeVerifySchema,
  createPenNameSchema,
  deleteAccountSchema,
  penNameIdSchema,
  updateProfileSchema,
  updatePenNameSchema,
} from '@novel/contracts';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SESSION_COOKIE_NAME } from '../auth/auth.constants';
import { clearSessionCookieOptions } from '../auth/session-cookie';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { usersError } from './users.errors';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
@UseGuards(SessionAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Return the signed-in author account profile' })
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.users.getProfile(this.requireUserId(request));
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the signed-in author account profile' })
  updateProfile(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw usersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请填写有效的账号资料',
        parsed.error.flatten(),
      );
    }
    return this.users.updateProfile(
      this.requireUserId(request),
      parsed.data,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
  }

  @Get('me/export')
  @Header('Content-Disposition', 'attachment; filename="novelbrain-account-export.json"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Export the signed-in author account data without model keys' })
  export(@Req() request: AuthenticatedRequest) {
    if (!request.auth) {
      throw usersError(401, 'UNAUTHENTICATED', '请先登录');
    }
    return this.users.exportAccount(
      request.auth.user.id,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
  }

  @Get('me/pen-names')
  @ApiOperation({ summary: 'List the signed-in author pen names' })
  listPenNames(@Req() request: AuthenticatedRequest) {
    return this.users.listPenNames(this.requireUserId(request));
  }

  @Post('me/pen-names')
  @ApiOperation({ summary: 'Create a pen name for the signed-in author' })
  createPenName(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = createPenNameSchema.safeParse(body);
    if (!parsed.success) {
      throw usersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请填写有效的笔名',
        parsed.error.flatten(),
      );
    }
    return this.users.createPenName(
      this.requireUserId(request),
      parsed.data,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
  }

  @Patch('me/pen-names/:penNameId')
  @ApiOperation({ summary: 'Update one of the signed-in author pen names' })
  updatePenName(
    @Param('penNameId') penNameId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedId = penNameIdSchema.safeParse(penNameId);
    const parsed = updatePenNameSchema.safeParse(body);
    if (!parsedId.success || !parsed.success) {
      throw usersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请填写有效的笔名',
        parsed.success ? undefined : parsed.error.flatten(),
      );
    }
    return this.users.updatePenName(
      this.requireUserId(request),
      parsedId.data,
      parsed.data,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
  }

  @Delete('me/pen-names/:penNameId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of the signed-in author pen names' })
  async deletePenName(
    @Param('penNameId') penNameId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const parsed = penNameIdSchema.safeParse(penNameId);
    if (!parsed.success) {
      throw usersError(HttpStatus.NOT_FOUND, 'PEN_NAME_NOT_FOUND', '没有找到这个笔名');
    }
    await this.users.deletePenName(
      this.requireUserId(request),
      parsed.data,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
  }

  @Post('me/email/change')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a verification code to a new email address' })
  async requestEmailChange(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = emailChangeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw usersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请输入新邮箱和当前密码',
        parsed.error.flatten(),
      );
    }
    return this.users.requestEmailChange(
      this.requireUserId(request),
      parsed.data.newEmail,
      parsed.data.currentPassword,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
  }

  @Post('me/email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Verify a new email address and invalidate every session' })
  async verifyEmailChange(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const parsed = emailChangeVerifySchema.safeParse(body);
    if (!parsed.success) {
      throw usersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请输入新邮箱和 6 位验证码',
        parsed.error.flatten(),
      );
    }
    await this.users.verifyEmailChange(
      this.requireUserId(request),
      parsed.data.newEmail,
      parsed.data.code,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
    response.clearCookie(
      SESSION_COOKIE_NAME,
      clearSessionCookieOptions(this.config.get<boolean>('COOKIE_SECURE') === true),
    );
  }

  @Post('me/delete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a recoverable account deletion' })
  async requestDeletion(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = deleteAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw usersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请输入当前密码，并输入“注销账号”完成确认',
        parsed.error.flatten(),
      );
    }
    const result = await this.users.requestDeletion(
      this.requireUserId(request),
      parsed.data.password,
      request.ip ?? request.socket.remoteAddress ?? null,
      request.get('user-agent') ?? null,
    );
    response.clearCookie(
      SESSION_COOKIE_NAME,
      clearSessionCookieOptions(this.config.get<boolean>('COOKIE_SECURE') === true),
    );
    return result;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw usersError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', '请先登录');
    }
    return request.auth.user.id;
  }
}
