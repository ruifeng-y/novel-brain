import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createCharacterArcSchema,
  createForeshadowSchema,
  createStoryThreadSchema,
  updateCharacterArcSchema,
  updateForeshadowSchema,
  updateStoryThreadSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { storyPlanningError } from './story-planning.errors';
import { StoryLedgerService } from './story-ledger.service';

@ApiTags('story-ledger')
@Controller('works/:workId/branches/:branchId')
@UseGuards(SessionAuthGuard)
export class StoryLedgerController {
  constructor(private readonly storyLedger: StoryLedgerService) {}

  @Get('story-ledger')
  @ApiOperation({ summary: 'Read plot lines, foreshadows, character arcs, and story checks' })
  getLedger(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.storyLedger.getLedger(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  @Get('story-ledger/checks')
  @ApiOperation({ summary: 'Check overdue foreshadows, open plot lines, and motivation gaps' })
  getChecks(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.storyLedger.getChecks(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  @Post('threads')
  @ApiOperation({ summary: 'Create a plot line for a work branch' })
  createThread(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createStoryThreadSchema.safeParse(body);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the plot line details',
        parsed.error.flatten(),
      );
    }
    return this.storyLedger.createThread(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      parsed.data,
    );
  }

  @Patch('threads/:threadId')
  @ApiOperation({ summary: 'Update a plot line' })
  updateThread(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateStoryThreadSchema.safeParse(body);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the plot line details',
        parsed.error.flatten(),
      );
    }
    return this.storyLedger.updateThread(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseThreadId(threadId),
      parsed.data,
    );
  }

  @Delete('threads/:threadId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a plot line' })
  deleteThread(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('threadId') threadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.storyLedger.deleteThread(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseThreadId(threadId),
    );
  }

  @Post('foreshadows')
  @ApiOperation({ summary: 'Plant a foreshadow for a work branch' })
  createForeshadow(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createForeshadowSchema.safeParse(body);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the foreshadow details',
        parsed.error.flatten(),
      );
    }
    return this.storyLedger.createForeshadow(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      parsed.data,
    );
  }

  @Patch('foreshadows/:foreshadowId')
  @ApiOperation({ summary: 'Update or pay off a foreshadow' })
  updateForeshadow(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('foreshadowId') foreshadowId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateForeshadowSchema.safeParse(body);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the foreshadow details',
        parsed.error.flatten(),
      );
    }
    return this.storyLedger.updateForeshadow(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseForeshadowId(foreshadowId),
      parsed.data,
    );
  }

  @Post('character-arcs')
  @ApiOperation({ summary: 'Save a character arc for a work branch' })
  saveCharacterArc(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createCharacterArcSchema.safeParse(body);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the character arc details',
        parsed.error.flatten(),
      );
    }
    return this.storyLedger.saveCharacterArc(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      parsed.data,
    );
  }

  @Patch('character-arcs/:arcId')
  @ApiOperation({ summary: 'Update a character arc' })
  updateCharacterArc(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('arcId') arcId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateCharacterArcSchema.safeParse(body);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the character arc details',
        parsed.error.flatten(),
      );
    }
    return this.storyLedger.updateCharacterArc(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseArcId(arcId),
      parsed.data,
    );
  }

  private parseId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw storyPlanningError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }

  private parseForeshadowId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.NOT_FOUND,
        'FORESHADOW_NOT_FOUND',
        'Foreshadow not found',
      );
    }
    return parsed.data;
  }

  private parseArcId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.NOT_FOUND,
        'CHARACTER_ARC_NOT_FOUND',
        'Character arc not found',
      );
    }
    return parsed.data;
  }

  private parseThreadId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'THREAD_NOT_FOUND', 'Plot line not found');
    }
    return parsed.data;
  }
}
