import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { workIdSchema } from '@novel/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { chapterGenerationError } from './chapter-generation.errors';
import { ChapterGenerationService } from './chapter-generation.service';

@Injectable()
export class GenerationJobAccessGuard implements CanActivate {
  constructor(private readonly chapters: ChapterGenerationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & Request>();
    if (!request.auth) {
      throw chapterGenerationError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Sign in to continue',
      );
    }
    const workId = workIdSchema.safeParse(request.params.workId);
    const branchId = workIdSchema.safeParse(request.params.branchId);
    const jobId = workIdSchema.safeParse(request.params.jobId);
    if (!workId.success || !branchId.success || !jobId.success) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'GENERATION_JOB_NOT_FOUND',
        'Generation task not found',
      );
    }
    await this.chapters.assertJobAccess(
      request.auth.user.id,
      workId.data,
      branchId.data,
      jobId.data,
    );
    return true;
  }
}
