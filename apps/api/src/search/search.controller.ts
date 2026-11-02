import { Controller, Get, HttpStatus, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { workIdSchema, workSearchQuerySchema } from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { searchError } from './search.errors';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('works/:workId/branches/:branchId/search')
@UseGuards(SessionAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Search settings, outlines, and chapter text in one work branch' })
  find(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = workSearchQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw searchError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Enter a search phrase',
        parsed.error.flatten(),
      );
    }

    return this.search.search(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', 'Work not found'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', 'Story branch not found'),
      parsed.data,
    );
  }

  private parseId(value: string, code: string, message: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw searchError(HttpStatus.NOT_FOUND, code, message);
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw searchError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
