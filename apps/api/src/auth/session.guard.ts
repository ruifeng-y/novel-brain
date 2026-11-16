import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from "@nestjs/core";

import { ApiError } from "../common/api-error";
import { ALLOW_ACCOUNT_DELETION_PENDING } from "./allow-account-deletion-pending.decorator";
import type { AuthenticatedRequest } from "./auth.types";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from "./auth.service";
import { SESSION_COOKIE, parseCookies } from "./cookies";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const auth = await this.authService.resolveSession(token);
    if (!auth) {
      throw new ApiError(401, "AUTH_SESSION_INVALID", "登录状态已失效，请重新登录");
    }
    const allowDeletionPending = this.reflector.getAllAndOverride<boolean>(
      ALLOW_ACCOUNT_DELETION_PENDING,
      [context.getHandler(), context.getClass()],
    );
    if (
      auth.user.status !== "active" &&
      !(allowDeletionPending && auth.user.status === "deletion_pending")
    ) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "当前账号已被禁用");
    }
    request.auth = auth;
    return true;
  }
}
