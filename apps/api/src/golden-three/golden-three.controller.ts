import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import {
  goldenThreeCandidateBatchRequestSchema,
  goldenThreeLockRequestSchema,
  goldenThreeReviewBatchRequestSchema,
  goldenThreeSelectionRequestSchema,
  goldenThreeWorkspaceResponseSchema,
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
import { GoldenThreeService } from "./golden-three.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const workspaceJsonSchema = schemaOf(goldenThreeWorkspaceResponseSchema);
const candidateBatchBodyJsonSchema = schemaOf(goldenThreeCandidateBatchRequestSchema, "input");
const reviewBatchBodyJsonSchema = schemaOf(goldenThreeReviewBatchRequestSchema, "input");
const selectionBodyJsonSchema = schemaOf(goldenThreeSelectionRequestSchema, "input");
const lockBodyJsonSchema = schemaOf(goldenThreeLockRequestSchema, "input");

@ApiTags("golden-three")
@Controller("works/:workId/branches/:branchId/golden-three")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class GoldenThreeController {
  constructor(private readonly service: GoldenThreeService) {}

  @Get()
  @ApiOkResponse({
    description: "Golden three candidates and lock gate",
    schema: workspaceJsonSchema,
  })
  async workspace(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return goldenThreeWorkspaceResponseSchema.parse({
      data: await this.service.workspace(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("candidates")
  @HttpCode(201)
  @ApiBody({ schema: candidateBatchBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Golden three candidate workspace",
    schema: workspaceJsonSchema,
  })
  async createCandidates(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Headers("Idempotency-Key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return goldenThreeWorkspaceResponseSchema.parse({
      data: await this.service.createCandidates(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        idempotencyKey,
        goldenThreeCandidateBatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Put("candidates/:candidateId/reviews")
  @ApiBody({ schema: reviewBatchBodyJsonSchema })
  @ApiOkResponse({ description: "Golden three review workspace", schema: workspaceJsonSchema })
  async submitReviews(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("candidateId") candidateId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return goldenThreeWorkspaceResponseSchema.parse({
      data: await this.service.submitReviews(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(candidateId),
        goldenThreeReviewBatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("candidates/:candidateId/select")
  @HttpCode(200)
  @ApiBody({ schema: selectionBodyJsonSchema })
  @ApiOkResponse({ description: "Selected golden three candidate", schema: workspaceJsonSchema })
  async selectCandidate(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("candidateId") candidateId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return goldenThreeWorkspaceResponseSchema.parse({
      data: await this.service.selectCandidate(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(candidateId),
        goldenThreeSelectionRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("candidates/:candidateId/lock")
  @HttpCode(200)
  @ApiBody({ schema: lockBodyJsonSchema })
  @ApiOkResponse({ description: "Locked golden three candidate", schema: workspaceJsonSchema })
  async lockCandidate(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("candidateId") candidateId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return goldenThreeWorkspaceResponseSchema.parse({
      data: await this.service.lockCandidate(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(candidateId),
        goldenThreeLockRequestSchema.parse(body),
        this.auditContext(request, requestId),
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

  private auditContext(request: AuthenticatedRequest, requestId: string) {
    const userAgent = String(request.headers["user-agent"] ?? "").trim();
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: userAgent || "unknown",
    };
  }
}
