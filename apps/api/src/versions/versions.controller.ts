import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditSearchSchema, rollbackVersionSchema, workIdSchema } from '@novel/contracts';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { branchesError } from '../branches/branches.errors';
import { BranchStateService } from '../branches/branch-state.service';
import { AuditService } from './audit.service';
import { VersionGraphService } from './version-graph.service';

@ApiTags('versions')
@Controller('works/:workId/branches/:branchId')
@UseGuards(SessionAuthGuard)
export class VersionsController {
  constructor(
    private readonly versions: VersionGraphService,
    private readonly audit: AuditService,
    private readonly branchState: BranchStateService,
  ) {}

  @Get('versions')
  @ApiOperation({ summary: 'Read the version graph for a work' })
  graph(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.versions.getGraph(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
    );
  }

  @Post('rollback')
  @ApiOperation({ summary: 'Restore a saved version as a new immutable version' })
  rollback(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = rollbackVersionSchema.safeParse(body);
    if (!parsed.success) {
      throw branchesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Choose a version and record why you want to return to it',
        parsed.error.flatten(),
      );
    }
    return this.versions.rollback(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      parsed.data,
    );
  }

  @Get('audit')
  @ApiOperation({ summary: 'Search the author-visible history for a story line' })
  async history(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = auditSearchSchema.safeParse(query);
    if (!parsed.success) {
      throw branchesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the history search',
        parsed.error.flatten(),
      );
    }
    const userId = this.requireUserId(request);
    const parsedWorkId = this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found');
    const parsedBranchId = this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found');
    await this.versions.getGraph(userId, parsedWorkId, parsedBranchId);
    return this.audit.search(
      parsedWorkId,
      await this.branchState.logicalBranchId(parsedBranchId),
      parsed.data.q,
      parsed.data.limit,
    );
  }

  @Get('audit/export')
  @ApiOperation({ summary: 'Export filtered author-visible history as CSV' })
  async exportHistory(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = auditSearchSchema.safeParse(query);
    if (!parsed.success) {
      throw branchesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the history search',
        parsed.error.flatten(),
      );
    }
    const userId = this.requireUserId(request);
    const parsedWorkId = this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found');
    const parsedBranchId = this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found');
    await this.versions.getGraph(userId, parsedWorkId, parsedBranchId);
    const exported = await this.audit.exportCsv(
      parsedWorkId,
      await this.branchState.logicalBranchId(parsedBranchId),
      parsed.data.q,
    );
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    return exported.csv;
  }

  private parseId(value: string, code: string, message: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw branchesError(HttpStatus.NOT_FOUND, code, message);
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw branchesError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
