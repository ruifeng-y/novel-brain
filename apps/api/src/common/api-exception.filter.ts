import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import { apiErrorSchema } from "@novel-brain/contracts";
import {
  LogRedactionError,
  createRequestId,
  isSafeDiagnosticValue,
  parseLogCanaryValues,
  sanitizeDiagnosticText,
  sanitizeStructuredPayload,
} from "@novel-brain/core";
import type { Response } from "express";
import { ZodError } from "zod";

import { AppLogger } from "../logging/app-logger";
import { ApiError } from "./api-error";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Pick<AppLogger, "error"> = new AppLogger(),
    private readonly canaryValues: readonly string[] = parseLogCanaryValues(
      process.env.LOG_CANARY_VALUES,
    ),
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = createRequestId();

    if (exception instanceof ApiError) {
      response.status(exception.status).json(
        apiErrorSchema.parse({
          error: {
            code: exception.code,
            message: safePublicMessage(exception.message, exception.status, this.canaryValues),
            details: safeDetails(exception.details, this.canaryValues),
            requestId,
          },
        }),
      );
      return;
    }

    if (exception instanceof ZodError) {
      response.status(400).json(
        apiErrorSchema.parse({
          error: {
            code: "VALIDATION_INVALID",
            message: "输入内容不完整或格式不正确",
            details: {
              issues: exception.issues.map(({ path, message }) => ({
                path: safeValidationPath(path, this.canaryValues),
                message: safePublicMessage(message, 400, this.canaryValues),
              })),
            },
            requestId,
          },
        }),
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(
        apiErrorSchema.parse({
          error: {
            code: status === 401 ? "AUTH_SESSION_INVALID" : "INTERNAL_ERROR",
            message: safePublicMessage(exception.message, status, this.canaryValues),
            details: {},
            requestId,
          },
        }),
      );
      return;
    }

    this.logger.error(
      {
        event: "api.unhandled_error",
        errorType: exception instanceof Error ? exception.name : "unknown",
      },
      undefined,
      "ApiExceptionFilter",
    );
    response.status(500).json(
      apiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "服务暂时不可用",
          details: {},
          requestId,
        },
      }),
    );
  }
}

function publicErrorMessage(status: number): string {
  if (status === 400) {
    return "输入内容不完整或格式不正确";
  }
  if (status === 401) {
    return "登录状态已失效，请重新登录";
  }
  if (status === 403) {
    return "当前账号无权执行此操作";
  }
  if (status === 404) {
    return "请求的资源不存在或无权访问";
  }
  if (status === 409) {
    return "当前状态不允许执行此操作，请刷新后重试";
  }
  if (status === 429) {
    return "请求过于频繁，请稍后再试";
  }
  if (status === 502) {
    return "模型服务暂时不可用，请稍后重试";
  }
  return "服务暂时不可用";
}

function safeValidationPath(
  path: readonly PropertyKey[],
  canaryValues: readonly string[],
): Array<string | number> {
  const safePath: Array<string | number> = [];
  for (const segment of path) {
    if (typeof segment === "number") {
      safePath.push(segment);
      continue;
    }
    if (
      typeof segment !== "string" ||
      !/^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/u.test(segment) ||
      !isSafeDiagnosticValue(segment) ||
      canaryValues.some((canary) => canary.length > 0 && segment.includes(canary))
    ) {
      continue;
    }
    safePath.push(segment);
  }
  return safePath;
}

function safePublicMessage(
  message: string,
  status: number,
  canaryValues: readonly string[],
): string {
  try {
    const sanitized = sanitizeDiagnosticText(message, { canaryValues });
    return typeof sanitized === "string" && sanitized.trim().length > 0
      ? sanitized
      : publicErrorMessage(status);
  } catch {
    return publicErrorMessage(status);
  }
}

function safeDetails(
  details: Record<string, unknown>,
  canaryValues: readonly string[],
): Record<string, unknown> {
  try {
    const sanitized = sanitizeStructuredPayload(details, { canaryValues });
    return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? (sanitized as Record<string, unknown>)
      : {};
  } catch (error) {
    if (error instanceof LogRedactionError) {
      return {};
    }
    return {};
  }
}
