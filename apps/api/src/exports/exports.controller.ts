import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createExportRequestSchema,
  exportPreviewRequestSchema,
  workIdSchema,
} from '@novel/contracts';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { exportsError } from './exports.errors';
import { ExportsService } from './exports.service';

@ApiTags('exports')
@Controller('works/:workId/branches/:branchId/exports')
@UseGuards(SessionAuthGuard)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post('preview')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Preview export chapters and table of contents' })
  preview(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = exportPreviewRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw exportsError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请选择导出格式、范围和预设',
        parsed.error.flatten(),
      );
    }
    return this.exports.preview(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      parsed.data,
    );
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create an export file or background export task' })
  create(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createExportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw exportsError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请选择导出格式、范围和预设',
        parsed.error.flatten(),
      );
    }
    return this.exports.create(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      parsed.data,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List seven-day export download history' })
  list(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.exports.list(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
    );
  }

  @Get(':exportId')
  @ApiOperation({ summary: 'Read one export task' })
  get(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('exportId') exportId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.exports.get(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(exportId, 'EXPORT_NOT_FOUND', 'Export not found'),
    );
  }

  @Get(':exportId/download')
  @ApiOperation({ summary: 'Download a completed export before it expires' })
  async download(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('exportId') exportId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const file = await this.exports.download(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(exportId, 'EXPORT_NOT_FOUND', 'Export not found'),
    );
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="novel-export"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(file.data);
  }

  private parseId(value: string, code: string, message: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw exportsError(HttpStatus.NOT_FOUND, code, message);
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw exportsError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
