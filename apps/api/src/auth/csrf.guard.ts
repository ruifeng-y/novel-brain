import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { ApiError } from "../common/api-error";
import { safeEqual } from "./auth-crypto";
import { CSRF_COOKIE, parseCookies } from "./cookies";

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return true;
    }

    const expectedOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
    if (request.headers.origin !== expectedOrigin) {
      throw new ApiError(403, "AUTH_ORIGIN_INVALID", "请求来源无效");
    }

    const cookieToken = parseCookies(request.headers.cookie)[CSRF_COOKIE];
    const headerToken = request.headers["x-csrf-token"];
    if (!cookieToken || typeof headerToken !== "string" || !safeEqual(cookieToken, headerToken)) {
      throw new ApiError(403, "AUTH_CSRF_INVALID", "CSRF 校验失败");
    }
    return true;
  }
}
