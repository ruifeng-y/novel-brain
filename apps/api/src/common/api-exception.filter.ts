import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import { apiErrorSchema } from "@novel-brain/contracts";
import {
  LogRedactionError,
  createRequestId,
  parseLogCanaryValues,
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
            message: safeMessage(exception.message, this.canaryValues),
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
                path,
                message: safeMessage(message, this.canaryValues),
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
            message: safeMessage(exception.message, this.canaryValues),
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

function safeMessage(message: string, canaryValues: readonly string[]): string {
  try {
    const sanitized = sanitizeStructuredPayload(message, { canaryValues });
    return typeof sanitized === "string" ? sanitized : "请求处理失败";
  } catch (error) {
    if (error instanceof LogRedactionError) {
      return "请求包含敏感信息，详细内容已隐藏";
    }
    return "请求处理失败";
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
