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
  batchPlanActionRequestSchema,
  batchPlanCreateRequestSchema,
  batchPlanItemListResponseSchema,
  batchPlanResponseSchema,
  batchCostReportGroupBySchema,
  batchCostReportResponseSchema,
  batchWorkItemStatusSchema,
  cursorPageQuerySchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
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

  @Get(":planId/cost-report")
  @ApiQuery({
    name: "groupBy",
    required: false,
    enum: ["volume", "chapter", "model", "time"],
  })
  @ApiOkResponse({ description: "Tenant-scoped batch cost and failure report" })
  async getCostReport(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("planId") planId: string,
    @Query("groupBy") groupBy?: string,
  ) {
    const requestId = createRequestId();
    const data = await this.service.getCostReport(
      this.userId(request),
      {
        workId: uuidV7Schema.parse(workId),
        branchId: uuidV7Schema.parse(branchId),
      },
      uuidV7Schema.parse(planId),
      batchCostReportGroupBySchema.parse(groupBy ?? "volume"),
    );
    return batchCostReportResponseSchema.parse({ data, requestId, meta: {} });
  }

  @Post(":planId/start")
  @HttpCode(202)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiAcceptedResponse({ description: "Started batch plan", schema: planJsonSchema })
  async start(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("planId") planId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.control(request, workId, branchId, planId, "start", idempotencyKey, body);
  }

  @Post(":planId/pause")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({ description: "Paused batch plan", schema: planJsonSchema })
  async pause(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("planId") planId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.control(request, workId, branchId, planId, "pause", idempotencyKey, body);
  }

  @Post(":planId/resume")
  @HttpCode(202)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiAcceptedResponse({ description: "Resumed batch plan", schema: planJsonSchema })
  async resume(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("planId") planId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.control(request, workId, branchId, planId, "resume", idempotencyKey, body);
  }

  @Post(":planId/cancel")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({ description: "Cancelled batch plan", schema: planJsonSchema })
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("planId") planId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.control(request, workId, branchId, planId, "cancel", idempotencyKey, body);
  }

  @Post(":planId/retry")
  @HttpCode(202)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiAcceptedResponse({ description: "Retried failed batch work", schema: planJsonSchema })
  async retry(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("planId") planId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.control(request, workId, branchId, planId, "retry", idempotencyKey, body);
  }

  private async control(
    request: AuthenticatedRequest,
    workId: string,
    branchId: string,
    planId: string,
    action: "start" | "pause" | "resume" | "cancel" | "retry",
    idempotencyKey: string | undefined,
    body: unknown,
  ) {
    const requestId = createRequestId();
    batchPlanActionRequestSchema.parse(body ?? {});
    return batchPlanResponseSchema.parse({
      data: await this.service.control(
        this.userId(request),
        {
          workId: uuidV7Schema.parse(workId),
          branchId: uuidV7Schema.parse(branchId),
        },
        uuidV7Schema.parse(planId),
        action,
        idempotencyKey ?? "",
        body,
        {
          requestId,
          ip: getClientIp(request) || "unknown",
          userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
        },
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
}
