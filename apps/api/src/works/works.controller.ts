import { Body, Controller, Get, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createWorkSchema, workIdSchema } from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { worksError } from './works.errors';
import { WorksService } from './works.service';

@ApiTags('works')
@Controller('works')
@UseGuards(SessionAuthGuard)
export class WorksController {
  constructor(private readonly worksService: WorksService) {}

  @Get()
  @ApiOperation({ summary: 'List the signed-in author works' })
  list(@Req() request: AuthenticatedRequest) {
    return this.worksService.list(this.requireUserId(request));
  }

  @Post()
  @ApiOperation({ summary: 'Create a work and its main branch' })
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = createWorkSchema.safeParse(body);
    if (!parsed.success) {
      throw worksError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Complete the work details',
        parsed.error.flatten(),
      );
    }

    return this.worksService.create(this.requireUserId(request), parsed.data);
  }

  @Get(':workId')
  @ApiOperation({ summary: 'Open one of the signed-in author works' })
  get(@Param('workId') workId: string, @Req() request: AuthenticatedRequest) {
    const parsed = workIdSchema.safeParse(workId);
    if (!parsed.success) {
      throw worksError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    return this.worksService.get(this.requireUserId(request), parsed.data);
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw worksError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
