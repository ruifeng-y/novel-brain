import {
  Body,
  Controller,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { historyCheckInputSchema, workIdSchema } from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { historyError } from './history.errors';
import { HistoryService } from './history.service';

@ApiTags('history')
@Controller('works/:workId/branches/:branchId/history')
@UseGuards(SessionAuthGuard)
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Post('checks')
  @ApiOperation({ summary: 'Check a history passage and army movement against the pack rules' })
  check(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = historyCheckInputSchema.safeParse(body);
    if (!parsed.success) {
      throw historyError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the passage, army, route, and planned days',
        parsed.error.flatten(),
      );
    }
    return this.historyService.check(
      this.requireUserId(request),
      this.parsePathId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parsePathId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      parsed.data,
    );
  }

  private parsePathId(value: string, code: string, message: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw historyError(HttpStatus.NOT_FOUND, code, message);
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw historyError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
