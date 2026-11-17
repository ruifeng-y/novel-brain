import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  publishCheckRequestSchema,
  publishPreviewListResponseSchema,
  publishPreviewResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import {
  ApiBody,
  ApiCreatedResponse,
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
  @ApiBody({ schema: requestJsonSchema })
  @ApiCreatedResponse({
    description: "Pinned publish check and reader preview",
    schema: previewJsonSchema,
  })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const context = this.context(workId, branchId);
    return publishPreviewResponseSchema.parse({
      data: await this.service.create(
        this.userId(request),
        context,
        publishCheckRequestSchema.parse(body ?? {}),
      ),
      requestId,
      meta: {},
    });
  }

  @Get()
  @ApiQuerySchema(z.object({}).strict())
  @ApiOkResponse({ description: "Recent pinned publish previews", schema: previewListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return publishPreviewListResponseSchema.parse({
      data: await this.service.list(this.userId(request), this.context(workId, branchId)),
      requestId,
      meta: {},
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
