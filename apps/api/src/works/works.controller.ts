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
  createWorkFromImportSchema,
  createWorkSchema,
  duplicateWorkSchema,
  updateWorkSchema,
  workIdSchema,
  workImportSchema,
  workListQuerySchema,
} from '@novel/contracts';
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
  list(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    const parsed = workListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw worksError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the library filters',
        parsed.error.flatten(),
      );
    }
    return this.worksService.list(this.requireUserId(request), parsed.data);
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

  @Post('import')
  @ApiOperation({ summary: 'Create a work from a TXT, Markdown, or DOCX manuscript' })
  createFromImport(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = createWorkFromImportSchema.safeParse(body);
    if (!parsed.success) {
      throw worksError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the work details and manuscript',
        parsed.error.flatten(),
      );
    }
    return this.worksService.createFromImport(this.requireUserId(request), parsed.data);
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

  @Patch(':workId')
  @ApiOperation({ summary: 'Update work details or move it through its lifecycle' })
  update(
    @Param('workId') workId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateWorkSchema.safeParse(body);
    if (!parsed.success) {
      throw worksError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the work details',
        parsed.error.flatten(),
      );
    }
    return this.worksService.update(
      this.requireUserId(request),
      this.parsePathId(workId),
      parsed.data,
    );
  }

  @Delete(':workId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Move a work to the 30-day recovery bin' })
  async remove(@Param('workId') workId: string, @Req() request: AuthenticatedRequest) {
    await this.worksService.softDelete(this.requireUserId(request), this.parsePathId(workId));
  }

  @Post(':workId/archive')
  @ApiOperation({ summary: 'Archive a work without deleting it' })
  archive(@Param('workId') workId: string, @Req() request: AuthenticatedRequest) {
    return this.worksService.archive(this.requireUserId(request), this.parsePathId(workId));
  }

  @Post(':workId/restore')
  @ApiOperation({ summary: 'Restore an archived or soft-deleted work' })
  restore(@Param('workId') workId: string, @Req() request: AuthenticatedRequest) {
    return this.worksService.restore(this.requireUserId(request), this.parsePathId(workId));
  }

  @Post(':workId/recover')
  @ApiOperation({ summary: 'Recover a soft-deleted work from the recovery bin' })
  recover(@Param('workId') workId: string, @Req() request: AuthenticatedRequest) {
    return this.worksService.restore(this.requireUserId(request), this.parsePathId(workId));
  }

  @Post(':workId/duplicate')
  @ApiOperation({ summary: 'Copy the story bible, settings, and outline into a new work' })
  duplicate(
    @Param('workId') workId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = duplicateWorkSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw worksError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Check the copied work details',
        parsed.error.flatten(),
      );
    }
    return this.worksService.duplicate(
      this.requireUserId(request),
      this.parsePathId(workId),
      parsed.data,
    );
  }

  @Post(':workId/import')
  @ApiOperation({ summary: 'Import a TXT, Markdown, or DOCX manuscript as chapter versions' })
  import(
    @Param('workId') workId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = workImportSchema.safeParse(body);
    if (!parsed.success) {
      throw worksError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Choose a supported manuscript file',
        parsed.error.flatten(),
      );
    }
    return this.worksService.importManuscript(
      this.requireUserId(request),
      this.parsePathId(workId),
      parsed.data,
    );
  }

  private parsePathId(workId: string): string {
    const parsed = workIdSchema.safeParse(workId);
    if (!parsed.success) {
      throw worksError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw worksError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');
    }
    return request.auth.user.id;
  }
}
