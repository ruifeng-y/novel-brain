import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  publishCheckRequestSchema,
  publishPreviewListQuerySchema,
  publishPreviewListResponseSchema,
  publishPreviewResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PublishPreviewService } from "./publish-preview.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output") {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const requestJsonSchema = schemaOf(publishCheckRequestSchema, "input");
const previewJsonSchema = schemaOf(publishPreviewResponseSchema);
const previewListJsonSchema = schemaOf(publishPreviewListResponseSchema);

@ApiTags("publish-previews")
@Controller("works/:workId/branches/:branchId/publish-check")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class PublishPreviewController {
  constructor(private readonly service: PublishPreviewService) {}

  @Post()
  @HttpCode(201)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for replaying the same publish check",
  })
  @ApiBody({ schema: requestJsonSchema })
  @ApiCreatedResponse({
    description: "Pinned publish check and reader preview",
    schema: previewJsonSchema,
  })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const context = this.context(workId, branchId);
    return publishPreviewResponseSchema.parse({
      data: await this.service.create(
        this.userId(request),
        context,
        publishCheckRequestSchema.parse(body ?? {}),
        idempotencyKey ?? "",
      ),
      requestId,
      meta: {},
    });
  }

  @Get()
  @ApiQuerySchema(publishPreviewListQuerySchema)
  @ApiOkResponse({ description: "Pinned publish preview history", schema: previewListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const result = await this.service.list(
      this.userId(request),
      this.context(workId, branchId),
      publishPreviewListQuerySchema.parse(query ?? {}),
    );
    return publishPreviewListResponseSchema.parse({
      data: result.previews,
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  }

  @Get(":previewId")
  @ApiOkResponse({ description: "Pinned publish preview", schema: previewJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("previewId") previewId: string,
  ) {
    const requestId = createRequestId();
    return publishPreviewResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        this.context(workId, branchId),
        uuidV7Schema.parse(previewId),
      ),
      requestId,
      meta: {},
    });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }

  private context(workId: string, branchId: string) {
    return {
      workId: uuidV7Schema.parse(workId),
      branchId: uuidV7Schema.parse(branchId),
    };
  }
}
