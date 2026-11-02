import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { batchReviewDecisionSchema, createBatchJobSchema, workIdSchema } from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { BatchJobsService } from './batch-jobs.service';
import { chapterGenerationError } from './chapter-generation.errors';
import { ChapterGenerationService } from './chapter-generation.service';

@ApiTags('jobs')
@Controller('works/:workId/branches/:branchId')
@UseGuards(SessionAuthGuard)
export class BatchJobsController {
  constructor(
    private readonly batchJobs: BatchJobsService,
    private readonly chapters: ChapterGenerationService,
  ) {}

  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create a chapter production task by chapter, volume, range, or book' })
  create(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createBatchJobSchema.safeParse(body);
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the batch task range and writing settings',
        parsed.error.flatten(),
      );
    }
    return this.batchJobs.create(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      parsed.data,
    );
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List chapter production tasks for the story branch' })
  list(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batchJobs.list(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
    );
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Read a chapter production task' })
  async get(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = this.requireUserId(request);
    const parsedWorkId = this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found');
    const parsedBranchId = this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found');
    const parsedJobId = this.parseId(
      jobId,
      'GENERATION_JOB_NOT_FOUND',
      'Generation task not found',
    );
    try {
      return await this.batchJobs.getJob(userId, parsedWorkId, parsedBranchId, parsedJobId);
    } catch (error) {
      if (!this.isBatchJobNotFound(error)) {
        throw error;
      }
      return this.chapters.getJob(userId, parsedWorkId, parsedBranchId, parsedJobId);
    }
  }

  @Post('jobs/:jobId/pause')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Pause a batch task after the current step' })
  pause(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batchJobs.pause(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(jobId, 'BATCH_JOB_NOT_FOUND', 'Batch task not found'),
    );
  }

  @Post('jobs/:jobId/resume')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Resume a paused batch task from its checkpoint' })
  resume(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batchJobs.resume(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(jobId, 'BATCH_JOB_NOT_FOUND', 'Batch task not found'),
    );
  }

  @Post('jobs/:jobId/cancel')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cancel a batch task and keep completed chapters' })
  cancel(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batchJobs.cancel(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(jobId, 'BATCH_JOB_NOT_FOUND', 'Batch task not found'),
    );
  }

  @Post('jobs/:jobId/retry')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Retry failed chapters from their failed step' })
  retry(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batchJobs.retry(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(jobId, 'BATCH_JOB_NOT_FOUND', 'Batch task not found'),
    );
  }

  @Get('review-queue')
  @ApiOperation({ summary: 'List generated chapters waiting for author review' })
  reviewQueue(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batchJobs.listReviewQueue(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
    );
  }

  @Post('jobs/:jobId/review/:itemId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Approve, send to the writing desk, reject, or ignore a review item' })
  review(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = batchReviewDecisionSchema.safeParse(body);
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Choose a review action',
        parsed.error.flatten(),
      );
    }
    return this.batchJobs.review(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(jobId, 'BATCH_JOB_NOT_FOUND', 'Batch task not found'),
      this.parseId(itemId, 'BATCH_REVIEW_ITEM_NOT_FOUND', 'Review item not found'),
      parsed.data,
    );
  }

  @Get('jobs/:jobId/report')
  @ApiOperation({ summary: 'Read the current batch task report' })
  report(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.batchJobs.getReport(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(jobId, 'BATCH_JOB_NOT_FOUND', 'Batch task not found'),
    );
  }

  private parseId(value: string, code: string, message: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw chapterGenerationError(HttpStatus.NOT_FOUND, code, message);
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw chapterGenerationError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Sign in to continue',
      );
    }
    return request.auth.user.id;
  }

  private isBatchJobNotFound(error: unknown): boolean {
    if (!(error instanceof HttpException)) {
      return false;
    }
    const response = error.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      response.code === 'BATCH_JOB_NOT_FOUND'
    );
  }
}
