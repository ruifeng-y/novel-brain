import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type ErrorCode,
  modelConfigInputSchema,
  modelConfigListQuerySchema,
  modelConfigDeleteResponseSchema,
  modelConfigResponseSchema,
  modelConfigUpdateSchema,
  modelConfigsResponseSchema,
  modelConnectionTestResponseSchema,
  modelProvidersResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

import { getClientIp } from "../auth/client-ip";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiError } from "../common/api-error";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ModelConfigService } from "./model-config.service";

function envelope<T>(data: T, requestId = createRequestId()) {
  return { data, requestId, meta: {} };
}

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const createBodySchema = schemaOf(modelConfigInputSchema);
const updateBodySchema = schemaOf(modelConfigUpdateSchema);
const configResponseSchema = schemaOf(modelConfigResponseSchema);
const configsResponseSchema = schemaOf(modelConfigsResponseSchema);
const providersResponseSchema = schemaOf(modelProvidersResponseSchema);
const testResponseSchema = schemaOf(modelConnectionTestResponseSchema);

@ApiTags("model-configs")
@Controller("model-configs")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ModelConfigController {
  constructor(private readonly service: ModelConfigService) {}

  @Get("providers")
  @ApiOkResponse({ description: "Allowed providers", schema: providersResponseSchema })
  getProviders() {
    return modelProvidersResponseSchema.parse(envelope(this.service.getProviders()));
  }

  @Get()
  @ApiQuerySchema(modelConfigListQuerySchema)
  @ApiOkResponse({ description: "User model configs", schema: configsResponseSchema })
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const requestId = createRequestId();
    const page = await this.service.list(
      this.userId(request),
      modelConfigListQuerySchema.parse(query ?? {}),
    );
    return modelConfigsResponseSchema.parse({
      data: page.data,
      requestId,
      meta: { nextCursor: page.nextCursor },
    });
  }

  @Post()
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiBody({ schema: createBodySchema })
  @ApiOkResponse({ description: "Created model config", schema: configResponseSchema })
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const requestId = createRequestId();
    const idempotencyKey =
      typeof request.headers["idempotency-key"] === "string"
        ? request.headers["idempotency-key"]
        : undefined;
    const config = await this.service.create(
      this.userId(request),
      modelConfigInputSchema.parse(body),
      this.auditContext(request, requestId),
      idempotencyKey,
    );
    return modelConfigResponseSchema.parse(envelope(config, requestId));
  }

  @Patch(":configId")
  @ApiBody({ schema: updateBodySchema })
  @ApiOkResponse({ description: "Updated model config", schema: configResponseSchema })
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("configId") configId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const audit = this.auditContext(request, requestId);
    const config = await this.service.update(
      this.userId(request),
      uuidV7Schema.parse(configId),
      modelConfigUpdateSchema.parse(body),
      audit,
    );
    return modelConfigResponseSchema.parse(envelope(config, requestId));
  }

  @Delete(":configId")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Deleted model config",
    schema: schemaOf(modelConfigDeleteResponseSchema),
  })
  async delete(@Req() request: AuthenticatedRequest, @Param("configId") configId: string) {
    const requestId = createRequestId();
    await this.service.delete(
      this.userId(request),
      uuidV7Schema.parse(configId),
      this.auditContext(request, requestId),
    );
    return modelConfigDeleteResponseSchema.parse(envelope({ deleted: true }, requestId));
  }

  @Post(":configId/test")
  @HttpCode(200)
  @ApiOkResponse({ description: "Connection test result", schema: testResponseSchema })
  async test(@Req() request: AuthenticatedRequest, @Param("configId") configId: string) {
    const result = await this.service.test(this.userId(request), uuidV7Schema.parse(configId));
    if (result.status !== "success") {
      throw new ApiError(400, connectionErrorCode(result.status), result.message, {
        status: result.status,
        latencyMs: result.latencyMs,
      });
    }
    return modelConnectionTestResponseSchema.parse(envelope(result));
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }

  private auditContext(request: AuthenticatedRequest, requestId: string) {
    const userAgent = String(request.headers["user-agent"] ?? "").trim();
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: userAgent || "unknown",
    };
  }
}

function connectionErrorCode(status: Exclude<ConnectionStatus, "success">): ErrorCode {
  switch (status) {
    case "key_invalid":
      return "MODEL_KEY_INVALID";
    case "rate_limited":
      return "MODEL_RATE_LIMITED";
    case "timeout":
      return "MODEL_TIMEOUT";
    case "provider_error":
      return "MODEL_PROVIDER_ERROR";
    case "error":
      return "MODEL_CONNECTION_FAILED";
  }
}

type ConnectionStatus = Awaited<ReturnType<ModelConfigService["test"]>>["status"];
