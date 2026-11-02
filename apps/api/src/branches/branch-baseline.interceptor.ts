import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { from, Observable, switchMap } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { BranchStateService } from './branch-state.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class BranchBaselineInterceptor implements NestInterceptor {
  constructor(private readonly branchState: BranchStateService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & Request>();
    const branchId = request.params?.branchId;
    if (typeof branchId !== 'string' || !UUID_PATTERN.test(branchId)) {
      return next.handle();
    }
    if ((request.path ?? request.url).endsWith('/events')) {
      return next.handle();
    }

    return from(
      this.branchState.resolveRequestBranch(
        branchId,
        request.method,
        request.path ?? request.url,
        request.auth?.user.id ?? '',
      ),
    ).pipe(
      switchMap((resolved) => {
        if (resolved.branchId !== branchId) {
          request.params.branchId = resolved.branchId;
        }
        if (resolved.idMap.size > 0) {
          replaceObject(
            request.params,
            this.branchState.remapValue(request.params, resolved.idMap),
          );
          replaceObject(request.query, this.branchState.remapValue(request.query, resolved.idMap));
          if (request.body && typeof request.body === 'object') {
            request.body = this.branchState.remapValue(request.body, resolved.idMap);
          }
        }
        return next.handle();
      }),
    );
  }
}

function replaceObject(target: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  Object.assign(target, next);
}
