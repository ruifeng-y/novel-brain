import { Body, Controller, Get, HttpStatus, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  chapterNumberSchema,
  chapterOutlineSchema,
  storyBibleSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { storyPlanningError } from './story-planning.errors';
import { StoryPlanningService } from './story-planning.service';

@ApiTags('story-planning')
@Controller('works/:workId/branches/:branchId')
@UseGuards(SessionAuthGuard)
export class StoryPlanningController {
  constructor(private readonly storyPlanning: StoryPlanningService) {}

  @Get('story-bible')
  @ApiOperation({ summary: 'Read the story bible for a work branch' })
  getStoryBible(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.storyPlanning.getStoryBible(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
    );
  }

  @Put('story-bible')
  @ApiOperation({ summary: 'Save the one-page story bible for a work branch' })
  saveStoryBible(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = storyBibleSchema.safeParse(body);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the story bible details',
        parsed.error.flatten(),
      );
    }

    return this.storyPlanning.saveStoryBible(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      parsed.data,
    );
  }

  @Get('chapter-outlines/:chapterNumber')
  @ApiOperation({ summary: 'Read a chapter outline for a work branch' })
  getChapterOutline(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.storyPlanning.getChapterOutline(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseChapterNumber(chapterNumber),
    );
  }

  @Put('chapter-outlines/:chapterNumber')
  @ApiOperation({ summary: 'Save a chapter outline for a work branch' })
  saveChapterOutline(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('chapterNumber') chapterNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = chapterOutlineSchema.safeParse(body);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the chapter outline details',
        parsed.error.flatten(),
      );
    }

    return this.storyPlanning.saveChapterOutline(
      this.requireUserId(request),
      this.parseId(workId),
      this.parseId(branchId),
      this.parseChapterNumber(chapterNumber),
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

  private parseChapterNumber(value: string): number {
    const parsed = chapterNumberSchema.safeParse(value);
    if (!parsed.success) {
      throw storyPlanningError(
        HttpStatus.NOT_FOUND,
        'CHAPTER_NOT_FOUND',
        'Chapter outline not found',
      );
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw storyPlanningError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
