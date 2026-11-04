import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  modelConfigInputSchema,
  modelConfigDeleteResponseSchema,
  modelConfigResponseSchema,
  modelConfigUpdateSchema,
  modelConfigsResponseSchema,
  modelConnectionTestResponseSchema,
  modelProvidersResponseSchema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ModelConfigService } from "./model-config.service";

function envelope<T>(data: T) {
  return { data, requestId: createRequestId(), meta: {} };
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
  @ApiOkResponse({ description: "User model configs", schema: configsResponseSchema })
  async list(@Req() request: AuthenticatedRequest) {
    return modelConfigsResponseSchema.parse(
      envelope(await this.service.list(this.userId(request))),
    );
  }

  @Post()
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiBody({ schema: createBodySchema })
  @ApiOkResponse({ description: "Created model config", schema: configResponseSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const config = await this.service.create(
      this.userId(request),
      modelConfigInputSchema.parse(body),
      idempotencyKey,
    );
    return modelConfigResponseSchema.parse(envelope(config));
  }

  @Patch(":configId")
  @ApiBody({ schema: updateBodySchema })
  @ApiOkResponse({ description: "Updated model config", schema: configResponseSchema })
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("configId") configId: string,
    @Body() body: unknown,
  ) {
    const config = await this.service.update(
      this.userId(request),
      configId,
      modelConfigUpdateSchema.parse(body),
    );
    return modelConfigResponseSchema.parse(envelope(config));
  }

  @Delete(":configId")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Deleted model config",
    schema: schemaOf(modelConfigDeleteResponseSchema),
  })
  async delete(@Req() request: AuthenticatedRequest, @Param("configId") configId: string) {
    await this.service.delete(this.userId(request), configId);
    return modelConfigDeleteResponseSchema.parse(envelope({ deleted: true }));
  }

  @Post(":configId/test")
  @HttpCode(200)
  @ApiOkResponse({ description: "Connection test result", schema: testResponseSchema })
  async test(@Req() request: AuthenticatedRequest, @Param("configId") configId: string) {
    return modelConnectionTestResponseSchema.parse(
      envelope(await this.service.test(this.userId(request), configId)),
    );
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }
}
