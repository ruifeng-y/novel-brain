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
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import {
  batchReviewClaimRequestSchema,
  batchReviewClaimResponseSchema,
  batchReviewDecisionRequestSchema,
  batchReviewDecisionResponseSchema,
  batchReviewQueueListResponseSchema,
  batchReviewQueueQuerySchema,
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
import { BatchReviewService } from "./batch-review.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output") {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const claimBodyJsonSchema = schemaOf(batchReviewClaimRequestSchema, "input");
const decisionBodyJsonSchema = schemaOf(batchReviewDecisionRequestSchema, "input");

@ApiTags("batch-review")
@Controller("works/:workId/branches/:branchId/review-queue")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class BatchReviewController {
  constructor(private readonly service: BatchReviewService) {}

  @Get()
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "risk", required: false })
  @ApiQuery({ name: "targetType", required: false })
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ description: "Tenant-scoped batch review queue" })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query("status") status?: string,
    @Query("risk") risk?: string,
    @Query("targetType") targetType?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const requestId = createRequestId();
    const query = batchReviewQueueQuerySchema.parse({
      status,
      risk,
      targetType,
      ...(cursor ? { cursor: uuidV7Schema.parse(cursor) } : {}),
      limit,
    });
    const page = await this.service.list(
      this.userId(request),
      {
        workId: uuidV7Schema.parse(workId),
        branchId: uuidV7Schema.parse(branchId),
      },
      query,
    );
    return batchReviewQueueListResponseSchema.parse({
      data: page.items,
      requestId,
      meta: { nextCursor: page.nextCursor, counts: page.counts },
    });
  }

  @Post("claim")
  @HttpCode(200)
  @ApiBody({ schema: claimBodyJsonSchema })
  @ApiOkResponse({ description: "Claimed batch review items" })
  async claim(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = batchReviewClaimRequestSchema.parse(body ?? {});
    const items = await this.service.claim(
      this.userId(request),
      {
        workId: uuidV7Schema.parse(workId),
        branchId: uuidV7Schema.parse(branchId),
      },
      input.itemIds,
    );
    return batchReviewClaimResponseSchema.parse({
      data: items,
      requestId,
      meta: {},
    });
  }

  @Post("decisions")
  @HttpCode(200)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for replaying the same review decision batch",
  })
  @ApiBody({ schema: decisionBodyJsonSchema })
  @ApiOkResponse({ description: "Independent batch review decision results" })
  async decide(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = batchReviewDecisionRequestSchema.parse(body ?? {});
    const userId = this.userId(request);
    const result = await this.service.decide(
      userId,
      {
        workId: uuidV7Schema.parse(workId),
        branchId: uuidV7Schema.parse(branchId),
      },
      idempotencyKey ?? "",
      input.items,
      {
        userId,
        requestId,
        ip: getClientIp(request) || "unknown",
        userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
      },
    );
    return batchReviewDecisionResponseSchema.parse({
      data: result.data,
      requestId,
      meta: { replayed: result.replayed },
    });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }
}
