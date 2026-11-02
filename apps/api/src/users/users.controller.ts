import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  accountAuditSearchSchema,
  accountExportIdSchema,
  createPenNameSchema,
  deleteAccountSchema,
  emailChangeRequestSchema,
  emailChangeVerifySchema,
  penNameIdSchema,
  updateProfileSchema,
  updatePenNameSchema,
} from '@novel/contracts';
import type { Response } from 'express';
import { AccountAuditService } from '../account-audit/account-audit.service';
import { SESSION_COOKIE_NAME } from '../auth/auth.constants';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { clearSessionCookieOptions } from '../auth/session-cookie';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AccountExportDownloadSigner } from './account-export-download.signer';
import { AccountExportsService } from './account-exports.service';
import { usersError } from './users.errors';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
@UseGuards(SessionAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly accountExports: AccountExportsService,
    private readonly accountAudit: AccountAuditService,
    private readonly downloadSigner: AccountExportDownloadSigner,
    private readonly config: ConfigService,
  ) {}

  @Get('me/audit')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Search the signed-in author account audit trail' })
  async audit(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = accountAuditSearchSchema.safeParse(query);
    if (!parsed.success) {
      throw usersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the account audit search',
        parsed.error.flatten(),
      );
    }
    return this.accountAudit.search(this.requireUserId(request), parsed.data);
  }

  @Get('me/audit/export')
  @ApiOperation({ summary: 'Export filtered account audit events as CSV' })
  async exportAudit(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = accountAuditSearchSchema.safeParse(query);
    if (!parsed.success) {
      throw usersError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the account audit search',
        parsed.error.flatten(),
      );
    }
    const exported = await this.accountAudit.exportCsv(
      this.requireUserId(request),
      parsed.data,
    );
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    response.setHeader('Cache-Control', 'no-store');
    return exported.csv;
  }
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

  @Post('me/export')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a complete background export of all author data' })
  createExport(@Req() request: AuthenticatedRequest) {
    return this.accountExports.create(this.requireUserId(request));
  }

  @Get('me/export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List recent complete account exports' })
  listExports(@Req() request: AuthenticatedRequest) {
    return this.accountExports.list(this.requireUserId(request));
  }

  @Get('me/export/:exportId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read a complete account export job' })
  getExport(@Param('exportId') exportId: string, @Req() request: AuthenticatedRequest) {
    return this.accountExports.get(
      this.requireUserId(request),
      this.parseExportId(exportId),
    );
  }

  @Get('me/export/:exportId/download')
  @ApiOperation({ summary: 'Download a complete account export through a signed URL' })
  async downloadExport(
    @Param('exportId') exportId: string,
    @Query('expires') expires: string | undefined,
    @Query('signature') signature: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const userId = this.requireUserId(request);
    const parsedExportId = this.parseExportId(exportId);
    const expiresAt = Number(expires);
    if (
      !signature ||
      !this.downloadSigner.verify(userId, parsedExportId, expiresAt, signature)
    ) {
      throw usersError(
        HttpStatus.FORBIDDEN,
        'INVALID_DOWNLOAD_SIGNATURE',
        '下载链接无效或已过期，请重新打开导出任务',
      );
    }
    const file = await this.accountExports.download(userId, parsedExportId);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="novel-account-export.zip"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(file.data);
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

  private parseExportId(value: string): string {
    const parsed = accountExportIdSchema.safeParse(value);
    if (!parsed.success) {
      throw usersError(HttpStatus.NOT_FOUND, 'EXPORT_NOT_FOUND', '导出任务不存在');
    }
    return parsed.data;
  }
}
