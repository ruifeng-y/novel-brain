import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { accountAuditSearchSchema, accountExportIdSchema } from '@novel/contracts';
import type { Response } from 'express';
import { AccountAuditService } from '../audit/account-audit.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AccountExportDownloadSigner } from './account-export-download.signer';
import { AccountExportsService } from './account-exports.service';
import { usersError } from './users.errors';

@ApiTags('users')
@Controller('users')
@UseGuards(SessionAuthGuard)
export class UsersController {
  constructor(
    private readonly accountExports: AccountExportsService,
    private readonly accountAudit: AccountAuditService,
    private readonly downloadSigner: AccountExportDownloadSigner,
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
  getExport(
    @Param('exportId') exportId: string,
    @Req() request: AuthenticatedRequest,
  ) {
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
