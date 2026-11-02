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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createOutlineNodeSchema,
  deleteOutlineNodeSchema,
  outlineIdSchema,
  outlineReadinessQuerySchema,
  regenerateOutlineNodeSchema,
  reorderOutlineNodesSchema,
  updateOutlineNodeSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { OutlineService } from './outline.service';
import { storyPlanningError } from './story-planning.errors';

@ApiTags('planning')
@Controller('works/:workId/branches/:branchId')
@UseGuards(SessionAuthGuard)
export class OutlineController {
  constructor(private readonly outlines: OutlineService) {}

  @Get('outlines')
  @ApiOperation({ summary: 'List the five-level outline tree for a work branch' })
  list(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.outlines.list(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
    );
  }

  @Post('outlines')
  @ApiOperation({ summary: 'Create an outline node' })
  create(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createOutlineNodeSchema.safeParse(body);
    if (!parsed.success) {
      throw this.validationError(parsed.error.flatten());
    }
    return this.outlines.create(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      parsed.data,
    );
  }

  @Post('outlines/reorder')
  @ApiOperation({ summary: 'Reorder sibling outline nodes' })
  reorder(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = reorderOutlineNodesSchema.safeParse(body);
    if (!parsed.success) {
      throw this.validationError(parsed.error.flatten());
    }
    return this.outlines.reorder(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      parsed.data,
    );
  }

  @Get('outlines/:outlineId')
  @ApiOperation({ summary: 'Read an outline node' })
  get(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('outlineId') outlineId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.outlines.get(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      this.parseOutlineId(outlineId),
    );
  }

  @Patch('outlines/:outlineId')
  @ApiOperation({ summary: 'Edit an outline node' })
  update(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('outlineId') outlineId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateOutlineNodeSchema.safeParse(body);
    if (!parsed.success) {
      throw this.validationError(parsed.error.flatten());
    }
    return this.outlines.update(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      this.parseOutlineId(outlineId),
      parsed.data,
    );
  }

  @Delete('outlines/:outlineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an outline node and its children' })
  async remove(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('outlineId') outlineId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const parsed = deleteOutlineNodeSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw this.validationError(parsed.error.flatten());
    }
    await this.outlines.remove(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      this.parseOutlineId(outlineId),
      parsed.data,
    );
  }

  @Post('outlines/:outlineId/lock')
  @ApiOperation({ summary: 'Lock an outline node' })
  lock(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('outlineId') outlineId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.outlines.lock(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      this.parseOutlineId(outlineId),
    );
  }

  @Post('outlines/:outlineId/unlock')
  @ApiOperation({ summary: 'Unlock an outline node' })
  unlock(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('outlineId') outlineId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.outlines.unlock(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      this.parseOutlineId(outlineId),
    );
  }

  @Post('outlines/:outlineId/regenerate')
  @ApiOperation({ summary: 'Regenerate only one outline node' })
  regenerate(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('outlineId') outlineId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = regenerateOutlineNodeSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw this.validationError(parsed.error.flatten());
    }
    return this.outlines.regenerate(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      this.parseOutlineId(outlineId),
      parsed.data,
    );
  }

  @Get('outline/readiness')
  @ApiOperation({ summary: 'Check generation readiness for a work branch' })
  readiness(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = outlineReadinessQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw this.validationError(parsed.error.flatten());
    }
    return this.outlines.readiness(
      this.requireUserId(request),
      this.parseWorkId(workId),
      this.parseWorkId(branchId),
      parsed.data,
    );
  }

  private parseWorkId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    return parsed.data;
  }

  private parseOutlineId(value: string): string {
    const parsed = outlineIdSchema.safeParse(value);
    if (!parsed.success) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'OUTLINE_NOT_FOUND', 'Outline node not found');
    }
    return parsed.data;
  }

  private validationError(details: unknown) {
    return storyPlanningError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'Complete the outline details',
      details,
    );
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw storyPlanningError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
