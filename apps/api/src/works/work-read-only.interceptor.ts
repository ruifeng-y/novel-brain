import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { from, type Observable, switchMap } from 'rxjs';
import { workBranches, works } from '@novel/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { worksError } from './works.errors';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WORK_LIFECYCLE_PATTERN = /\/(?:archive|restore|recover|duplicate)$/;
const READ_ONLY_OPERATIONS = ['/exports', '/publish', '/compare'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class WorkReadOnlyInterceptor implements NestInterceptor {
  constructor(private readonly database: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const userId = request.auth?.user.id;
    const workId = request.params?.workId;
    const branchId = request.params?.branchId;
    const path = request.path ?? request.url;
    if (
      !userId ||
      typeof workId !== 'string' ||
      !UUID_PATTERN.test(workId) ||
      !MUTATING_METHODS.has(request.method) ||
      this.isAllowedWorkOperation(request.method, path)
    ) {
      return next.handle();
    }

    return from(
      this.assertWritable(userId, workId, typeof branchId === 'string' ? branchId : undefined),
    ).pipe(switchMap(() => next.handle()));
  }

  private async assertWritable(
    userId: string,
    workId: string,
    branchId: string | undefined,
  ): Promise<void> {
    const [work] = await this.database.db
      .select({ status: works.status })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work || work.status !== 'completed') {
      return;
    }
    if (typeof branchId === 'string' && !UUID_PATTERN.test(branchId)) {
      return;
    }
    if (typeof branchId === 'string') {
      const [branch] = await this.database.db
        .select({ isMain: workBranches.isMain })
        .from(workBranches)
        .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
        .limit(1);
      if (branch && !branch.isMain) {
        return;
      }
    }

    throw worksError(409, 'WORK_COMPLETED_READ_ONLY', 'This finished work is read-only', {
      canReopen: true,
      canCreateParallel: true,
    });
  }

  private isAllowedWorkOperation(method: string, path: string): boolean {
    const normalized = path.replace(/^\/api\/v1/, '');
    if (method === 'PATCH' || method === 'DELETE') {
      return /^\/works\/[^/]+$/.test(normalized);
    }
    if (WORK_LIFECYCLE_PATTERN.test(normalized)) {
      return true;
    }
    if (/^\/works\/[^/]+\/branches$/.test(normalized)) {
      return true;
    }
    return READ_ONLY_OPERATIONS.some((operation) => normalized.includes(operation));
  }
}
