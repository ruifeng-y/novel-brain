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
  ApiAcceptedResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import {
  batchJobItemTypeSchema,
  batchPlanCreateRequestSchema,
  batchPlanItemListResponseSchema,
  batchPlanResponseSchema,
  batchWorkItemStatusSchema,
  cursorPageQuerySchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BatchPlanService } from "./batch-plan.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const createBodyJsonSchema = schemaOf(batchPlanCreateRequestSchema, "input");
const planJsonSchema = schemaOf(batchPlanResponseSchema);
const itemListJsonSchema = schemaOf(batchPlanItemListResponseSchema);

@ApiTags("batch")
@Controller("works/:workId/branches/:branchId/batch-plans")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class BatchPlanController {
  constructor(private readonly service: BatchPlanService) {}

  @Post()
  @HttpCode(202)
  @ApiBody({ schema: createBodyJsonSchema })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for replaying the same batch plan request",
  })
  @ApiAcceptedResponse({ description: "Persisted batch plan", schema: planJsonSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const result = await this.service.create(
      this.userId(request),
      {
        workId: uuidV7Schema.parse(workId),
        branchId: uuidV7Schema.parse(branchId),
      },
      idempotencyKey ?? "",
      body,
    );
    return batchPlanResponseSchema.parse({
      data: result.summary,
      requestId,
      meta: { replayed: result.replayed },
    });
  }

  @Get(":planId")
  @ApiOkResponse({ description: "Batch plan summary", schema: planJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("planId") planId: string,
  ) {
    const requestId = createRequestId();
    return batchPlanResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        {
          workId: uuidV7Schema.parse(workId),
          branchId: uuidV7Schema.parse(branchId),
        },
        uuidV7Schema.parse(planId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get(":planId/items")
  @ApiQuery({ name: "type", required: false })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ description: "Paginated batch work items", schema: itemListJsonSchema })
  async listItems(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("planId") planId: string,
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const requestId = createRequestId();
    const pageQuery = cursorPageQuerySchema.parse({ cursor, limit });
    const page = await this.service.listItems(
      this.userId(request),
      {
        workId: uuidV7Schema.parse(workId),
        branchId: uuidV7Schema.parse(branchId),
      },
      uuidV7Schema.parse(planId),
      {
        ...(type ? { type: batchJobItemTypeSchema.parse(type) } : {}),
        ...(status ? { status: batchWorkItemStatusSchema.parse(status) } : {}),
        ...(pageQuery.cursor ? { cursor: pageQuery.cursor } : {}),
        limit: pageQuery.limit,
      },
    );
    return batchPlanItemListResponseSchema.parse({
      data: page.items,
      requestId,
      meta: { nextCursor: page.nextCursor },
    });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }
}
