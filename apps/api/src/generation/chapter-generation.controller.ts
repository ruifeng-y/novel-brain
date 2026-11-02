import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  chapterNumberSchema,
  confirmFactProposalSchema,
  generateChapterSchema,
  ignoreContinuityIssueSchema,
  saveChapterAutosaveSchema,
  saveChapterVersionSchema,
  updateChapterMetadataSchema,
  updateFactProposalSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { chapterGenerationError } from './chapter-generation.errors';
import { ChapterGenerationService } from './chapter-generation.service';

@ApiTags('chapter-generation')
@Controller('works/:workId/branches/:branchId')
@UseGuards(SessionAuthGuard)
export class ChapterGenerationController {
  constructor(private readonly chapters: ChapterGenerationService) {}

  @Get('chapters')
  @ApiOperation({ summary: 'List chapters for the writing desk' })
  listChapters(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.listChapters(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
    );
  }

  @Get('chapters/:chapterNumber')
  @ApiOperation({ summary: 'Open a chapter in the writing desk' })
  getChapter(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.getChapter(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
    );
  }

  @Patch('chapters/:chapterNumber')
  @ApiOperation({ summary: 'Update chapter title, summary, or hook' })
  updateChapter(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateChapterMetadataSchema.safeParse(body);
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the chapter details',
        parsed.error.flatten(),
      );
    }
    return this.chapters.updateChapterMetadata(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      parsed.data,
    );
  }

  @Put('chapters/:chapterNumber/autosave')
  @ApiOperation({ summary: 'Autosave the chapter editor content' })
  autosaveChapter(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = saveChapterAutosaveSchema.safeParse(body);
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the chapter text before autosaving',
        parsed.error.flatten(),
      );
    }
    return this.chapters.autosaveChapter(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      parsed.data,
    );
  }

  @Post('chapters/:chapterNumber/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue chapter generation from the saved chapter outline' })
  generateChapter(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = generateChapterSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the chapter generation settings',
        parsed.error.flatten(),
      );
    }

    return this.chapters.startGeneration(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      parsed.data,
    );
  }

  @Post('chapters/:chapterNumber/continue')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Continue the chapter from the current cursor' })
  continueChapter(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = generateChapterSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the chapter writing settings',
        parsed.error.flatten(),
      );
    }

    return this.chapters.startGenerationAction(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      'continue',
      parsed.data,
    );
  }

  @Post('chapters/:chapterNumber/rewrite')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Rewrite selected chapter text' })
  rewriteSelection(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.startWritingAction('rewrite', workId, branchId, chapterNumber, body, request);
  }

  @Post('chapters/:chapterNumber/expand')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Expand selected chapter text' })
  expandSelection(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.startWritingAction('expand', workId, branchId, chapterNumber, body, request);
  }

  @Post('chapters/:chapterNumber/condense')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Condense selected chapter text' })
  condenseSelection(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.startWritingAction('condense', workId, branchId, chapterNumber, body, request);
  }

  @Post('chapters/:chapterNumber/change-pov')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Rewrite selected text from another point of view' })
  changePerspective(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.startWritingAction('change_pov', workId, branchId, chapterNumber, body, request);
  }

  @Post('chapters/:chapterNumber/hooks')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Generate three chapter-end hook options' })
  generateHooks(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.startWritingAction('hooks', workId, branchId, chapterNumber, body, request);
  }

  @Post('chapters/:chapterNumber/title')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Generate a chapter title' })
  generateTitle(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.startWritingAction('title', workId, branchId, chapterNumber, body, request);
  }

  @Post('chapters/:chapterNumber/summary')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Generate a chapter summary' })
  generateSummary(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.startWritingAction('summary', workId, branchId, chapterNumber, body, request);
  }

  @Get('chapters/:chapterNumber/versions')
  @ApiOperation({ summary: 'List saved chapter versions' })
  listVersions(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.listVersions(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
    );
  }

  @Get('chapters/:chapterNumber/fact-proposals')
  @ApiOperation({ summary: 'List author-reviewable facts extracted from a chapter' })
  listFactProposals(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.listFactProposals(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
    );
  }

  @Get('chapters/:chapterNumber/annotations')
  @ApiOperation({ summary: 'List continuity issues tied to chapter text' })
  listContinuityIssues(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.listContinuityIssues(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
    );
  }

  @Get('chapters/:chapterNumber/insights')
  @ApiOperation({ summary: 'Read review panels for the current chapter' })
  getWritingInsights(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.getWritingInsights(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
    );
  }

  @Patch('chapters/:chapterNumber/annotations/:annotationId')
  @ApiOperation({ summary: 'Ignore a continuity issue and record the author reason' })
  ignoreContinuityIssue(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Param('annotationId') annotationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = ignoreContinuityIssueSchema.safeParse(body);
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Record a reason before ignoring this continuity issue',
        parsed.error.flatten(),
      );
    }

    return this.chapters.ignoreContinuityIssue(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      this.parseId(
        annotationId,
        'CONTINUITY_ISSUE_NOT_FOUND',
        'Continuity issue not found',
      ),
      parsed.data,
    );
  }

  @Patch('chapters/:chapterNumber/fact-proposals/:proposalId')
  @ApiOperation({ summary: 'Edit a fact proposal before author review' })
  updateFactProposal(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateFactProposalSchema.safeParse(body);
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Add a clear statement before saving this fact',
        parsed.error.flatten(),
      );
    }

    return this.chapters.updateFactProposal(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      this.parseId(proposalId, 'FACT_PROPOSAL_NOT_FOUND', 'Fact proposal not found'),
      parsed.data.statement,
    );
  }

  @Post('chapters/:chapterNumber/fact-proposals/:proposalId/reject')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Reject a fact proposal' })
  rejectFactProposal(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Param('proposalId') proposalId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.rejectFactProposal(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      this.parseId(proposalId, 'FACT_PROPOSAL_NOT_FOUND', 'Fact proposal not found'),
    );
  }

  @Post('chapters/:chapterNumber/fact-proposals/:proposalId/confirm')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Confirm a fact proposal into the story world state' })
  confirmFactProposal(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = confirmFactProposalSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Add a clear statement before confirming this fact',
        parsed.error.flatten(),
      );
    }

    return this.chapters.confirmFactProposal(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      this.parseId(proposalId, 'FACT_PROPOSAL_NOT_FOUND', 'Fact proposal not found'),
      parsed.data,
    );
  }

  @Get('facts')
  @ApiOperation({ summary: 'List confirmed facts for the story branch' })
  listConfirmedFacts(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.listConfirmedFacts(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
    );
  }

  @Get('canon/commits')
  @ApiOperation({ summary: 'List canon commits for the story branch' })
  listCanonCommits(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.listCanonCommits(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
    );
  }

  @Get('canon/snapshots/:snapshotId')
  @ApiOperation({ summary: 'Read an immutable canon snapshot' })
  getCanonSnapshot(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('snapshotId') snapshotId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.getCanonSnapshot(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(snapshotId, 'CANON_SNAPSHOT_NOT_FOUND', 'Canon snapshot not found'),
    );
  }

  @Post('chapters/:chapterNumber/versions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save the current chapter text as a new version' })
  saveVersion(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = saveChapterVersionSchema.safeParse(body);
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Add chapter text before saving a version',
        parsed.error.flatten(),
      );
    }

    return this.chapters.saveVersion(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      parsed.data,
    );
  }

  @Post('chapters/:chapterNumber/versions/:versionId/restore')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Restore an older chapter version as a new version' })
  restoreVersion(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Param('versionId') versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.restoreVersion(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      this.parseId(versionId, 'CHAPTER_VERSION_NOT_FOUND', 'Chapter version not found'),
    );
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Read chapter generation task state' })
  getJob(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chapters.getJob(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(jobId, 'GENERATION_JOB_NOT_FOUND', 'Generation task not found'),
    );
  }

  @Sse('jobs/:jobId/events')
  @ApiOperation({ summary: 'Stream chapter generation progress and text deltas' })
  async streamJobEvents(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('jobId') jobId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const afterSequence = lastEventId ? Number.parseInt(lastEventId, 10) : 0;
    return this.chapters.streamJobEvents(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseId(jobId, 'GENERATION_JOB_NOT_FOUND', 'Generation task not found'),
      Number.isFinite(afterSequence) ? afterSequence : 0,
    );
  }

  private parseId(value: string, code: string, message: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw chapterGenerationError(HttpStatus.NOT_FOUND, code, message);
    }
    return parsed.data;
  }

  private startWritingAction(
    action:
      | 'rewrite'
      | 'expand'
      | 'condense'
      | 'change_pov'
      | 'hooks'
      | 'title'
      | 'summary',
    workId: string,
    branchId: string,
    chapterNumber: string,
    body: unknown,
    request: AuthenticatedRequest,
  ) {
    const parsed = generateChapterSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the chapter writing settings',
        parsed.error.flatten(),
      );
    }

    return this.chapters.startGenerationAction(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      this.parseChapterNumber(chapterNumber),
      action,
      parsed.data,
    );
  }

  private parseChapterNumber(value: string): number {
    const parsed = chapterNumberSchema.safeParse(value);
    if (!parsed.success) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'CHAPTER_OUTLINE_NOT_FOUND',
        'Chapter outline not found',
      );
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
}
