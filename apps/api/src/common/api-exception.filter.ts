import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import { apiErrorSchema } from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import type { Response } from "express";
import pino from "pino";
import { ZodError } from "zod";

import { ApiError } from "./api-error";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = pino({ base: { service: "api" } });

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = createRequestId();

    if (exception instanceof ApiError) {
      response.status(exception.status).json(
        apiErrorSchema.parse({
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details,
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
            details: { issues: exception.issues.map(({ path, message }) => ({ path, message })) },
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
            message: exception.message,
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
      "Unhandled API error",
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
