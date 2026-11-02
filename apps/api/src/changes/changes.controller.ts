import { Body, Controller, Get, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applyChangeRequestSchema,
  branchChangeRequestSchema,
  cancelChangeRequestSchema,
  createChangeRequestSchema,
  falsePositiveSchema,
  undoChangeRequestSchema,
  workIdSchema,
} from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { changesError } from './changes.errors';
import { ChangesService } from './changes.service';

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { flatten: () => Record<string, unknown> } };

@ApiTags('changes')
@Controller('works/:workId/branches/:branchId/changes')
@UseGuards(SessionAuthGuard)
export class ChangesController {
  constructor(private readonly changesService: ChangesService) {}

  @Get()
  @ApiOperation({ summary: 'List change requests for a story branch' })
  list(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.list(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
    );
  }

  @Get('targets')
  @ApiOperation({ summary: 'List content that can be changed' })
  targets(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.targets(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a change request without changing story content' })
  create(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.create(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parseBody(createChangeRequestSchema, body, 'Check the change details'),
    );
  }

  @Get(':changeId')
  @ApiOperation({ summary: 'Read one change request and its impact analysis' })
  get(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('changeId') changeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.get(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parsePathId(changeId),
    );
  }

  @Post(':changeId/analyze')
  @ApiOperation({ summary: 'Run impact analysis and all six consistency checks' })
  analyze(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('changeId') changeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.analyze(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parsePathId(changeId),
    );
  }

  @Post(':changeId/apply')
  @ApiOperation({ summary: 'Apply a safe change or a repaired change' })
  apply(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('changeId') changeId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.apply(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parsePathId(changeId),
      this.parseBody(
        applyChangeRequestSchema,
        body ?? {},
        'Choose whether to apply directly or after repairing the affected content',
      ),
    );
  }

  @Post(':changeId/undo')
  @ApiOperation({ summary: 'Undo one applied change as a new immutable version' })
  undo(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('changeId') changeId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.undo(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parsePathId(changeId),
      this.parseBody(
        undoChangeRequestSchema,
        body ?? {},
        'Check the reason for undoing this change',
      ),
    );
  }

  @Post(':changeId/branch')
  @ApiOperation({ summary: 'Create a parallel version for a structural change' })
  branch(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('changeId') changeId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.branch(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parsePathId(changeId),
      this.parseBody(branchChangeRequestSchema, body, 'Name the parallel version'),
    );
  }

  @Post(':changeId/cancel')
  @ApiOperation({ summary: 'Cancel a change request' })
  cancel(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('changeId') changeId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.cancel(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parsePathId(changeId),
      this.parseBody(cancelChangeRequestSchema, body ?? {}, 'Check the cancellation reason'),
    );
  }

  @Post(':changeId/reject')
  @ApiOperation({ summary: 'Reject a change request' })
  reject(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('changeId') changeId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.reject(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parsePathId(changeId),
      this.parseBody(cancelChangeRequestSchema, body ?? {}, 'Check the rejection reason'),
    );
  }

  @Post(':changeId/false-positive')
  @ApiOperation({ summary: 'Ignore one false positive and record why' })
  ignoreFalsePositive(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Param('changeId') changeId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.changesService.ignoreFalsePositive(
      this.requireUserId(request),
      this.parsePathId(workId),
      this.parsePathId(branchId),
      this.parsePathId(changeId),
      this.parseBody(
        falsePositiveSchema,
        body,
        'Choose the warning to ignore and record why it is a false positive',
      ),
    );
  }

  private parseBody<T>(
    schema: { safeParse: (body: unknown) => ParseResult<T> },
    body: unknown,
    message: string,
  ): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw changesError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        message,
        parsed.error.flatten(),
      );
    }
    return parsed.data;
  }

  private parsePathId(value: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw changesError(HttpStatus.NOT_FOUND, 'CHANGE_NOT_FOUND', 'Change not found');
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw changesError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
