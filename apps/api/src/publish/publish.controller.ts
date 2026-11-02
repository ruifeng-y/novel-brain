import { Body, Controller, Get, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { publishCheckRequestSchema, workIdSchema } from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { publishError } from './publish.errors';
import { PublishService } from './publish.service';

@ApiTags('publish')
@Controller('works/:workId/branches/:branchId/publish')
@UseGuards(SessionAuthGuard)
export class PublishController {
  constructor(private readonly publish: PublishService) {}

  @Post('check')
  @ApiOperation({ summary: 'Run the publish checklist and render a report' })
  check(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = publishCheckRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw publishError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        '请选择 TXT、Markdown、Word 文档或 EPUB 格式。',
        parsed.error.flatten(),
      );
    }
    return this.publish.check(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', '没有找到这部作品。'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', '没有找到这条创作线。'),
      parsed.data.format,
    );
  }

  @Get('preview')
  @ApiOperation({ summary: 'Read the first three chapters in reader mode' })
  preview(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.publish.preview(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', '没有找到这部作品。'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', '没有找到这条创作线。'),
    );
  }

  @Post('suggestions')
  @ApiOperation({ summary: 'Generate publishing metadata suggestions' })
  suggestions(
    @Param('workId') workId: string,
    @Param('branchId') branchId: string,
    @Body() _body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.publish.suggestions(
      this.requireUserId(request),
      this.parseId(workId, 'WORK_NOT_FOUND', '没有找到这部作品。'),
      this.parseId(branchId, 'BRANCH_NOT_FOUND', '没有找到这条创作线。'),
    );
  }

  private parseId(value: string, code: string, message: string): string {
    const parsed = workIdSchema.safeParse(value);
    if (!parsed.success) {
      throw publishError(HttpStatus.NOT_FOUND, code, message);
    }
    return parsed.data;
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw publishError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', '登录后才能继续。');
    }
    return request.auth.user.id;
  }
}
