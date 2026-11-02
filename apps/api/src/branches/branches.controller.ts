import { Body, Controller, Get, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  compareParallelVersionSchema,
  createParallelVersionSchema,
  cherryPickSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { branchesError } from './branches.errors';
import { BranchesService } from './branches.service';

@ApiTags('branches')
@Controller('works/:workId/branches')
@UseGuards(SessionAuthGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'List the main line and parallel versions' })
  list(@Param('workId') workId: string, @Req() request: AuthenticatedRequest) {
    return this.branchesService.list(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a parallel version from a saved version point' })
  create(
    @Param('workId') workId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createParallelVersionSchema.safeParse(body);
    if (!parsed.success) {
      throw branchesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the parallel version details',
        parsed.error.flatten(),
      );
    }
    return this.branchesService.create(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      parsed.data,
    );
  }

  @Get(':branchId/version-points')
  @ApiOperation({ summary: 'List saved version points along a story line' })
  versionPoints(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.branchesService.versionPoints(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
    );
  }

  @Post(':branchId/compare')
  @ApiOperation({ summary: 'Compare settings, outlines, and prose side by side' })
  compare(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = compareParallelVersionSchema.safeParse(body);
    if (!parsed.success) {
      throw branchesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Choose the parallel version to compare',
        parsed.error.flatten(),
      );
    }
    return this.branchesService.compare(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      parsed.data,
    );
  }

  @Post(':branchId/cherry-pick')
  @ApiOperation({ summary: 'Bring selected content from a parallel version into main' })
  cherryPick(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = cherryPickSchema.safeParse(body);
    if (!parsed.success) {
      throw branchesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Choose at least one item to bring back to the main line',
        parsed.error.flatten(),
      );
    }
    return this.branchesService.cherryPick(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      parsed.data,
    );
  }

  private parsePathId(value: string, code: string, message: string): string {
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
