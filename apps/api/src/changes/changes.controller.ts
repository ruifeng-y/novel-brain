import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  branchComparisonResponseSchema,
  branchCreateRequestSchema,
  branchCreateResponseSchema,
  changeAnalysisResponseSchema,
  changeApplyRequestSchema,
  changeApplyResponseSchema,
  changeRequestCreateRequestSchema,
  changeRequestListQuerySchema,
  changeRequestListResponseSchema,
  changeRequestResponseSchema,
  mergeApplyRequestSchema,
  mergeApplyResponseSchema,
  mergeItemDecisionRequestSchema,
  mergeItemDecisionResponseSchema,
  uuidV7Schema,
  versionRollbackRequestSchema,
  versionRollbackResponseSchema,
} from "@novel-brain/contracts";
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ChangesService } from "./changes.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const createBodySchema = schemaOf(changeRequestCreateRequestSchema);
const createResponseSchema = schemaOf(changeRequestResponseSchema);
const analysisResponseSchema = schemaOf(changeAnalysisResponseSchema);
const applyBodySchema = schemaOf(changeApplyRequestSchema);
const applyResponseSchema = schemaOf(changeApplyResponseSchema);
const comparisonResponseSchema = schemaOf(branchComparisonResponseSchema);
const decisionBodySchema = schemaOf(mergeItemDecisionRequestSchema);
const decisionResponseSchema = schemaOf(mergeItemDecisionResponseSchema);
const mergeApplyBodySchema = schemaOf(mergeApplyRequestSchema);
const mergeApplyResponseJsonSchema = schemaOf(mergeApplyResponseSchema);
const branchBodySchema = schemaOf(branchCreateRequestSchema);
const branchResponseSchema = schemaOf(branchCreateResponseSchema);
const rollbackBodySchema = schemaOf(versionRollbackRequestSchema);
const rollbackResponseSchema = schemaOf(versionRollbackResponseSchema);

@ApiTags("changes")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ChangesController {
  constructor(private readonly service: ChangesService) {}

  @Get("changes")
  @ApiQuerySchema(changeRequestListQuerySchema)
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const page = await this.service.list(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      changeRequestListQuerySchema.parse(query ?? {}),
    );
    return changeRequestListResponseSchema.parse({
      data: page.data,
      requestId,
      meta: { nextCursor: page.nextCursor },
    });
  }

  @Post("changes")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: createBodySchema })
  @ApiOkResponse({ description: "Created change request", schema: createResponseSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const idempotencyKey =
      typeof request.headers["idempotency-key"] === "string"
        ? request.headers["idempotency-key"]
        : "";
    const change = await this.service.create(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      changeRequestCreateRequestSchema.parse(body),
      idempotencyKey,
      this.auditContext(request, requestId),
    );
    return changeRequestResponseSchema.parse({ data: change, requestId, meta: {} });
  }

  @Post("changes/:changeId/analyze")
  @HttpCode(200)
  @ApiOkResponse({ description: "Change impact analysis", schema: analysisResponseSchema })
  async analyze(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("changeId") changeId: string,
  ) {
    const requestId = createRequestId();
    const result = await this.service.analyze(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      uuidV7Schema.parse(changeId),
    );
    return changeAnalysisResponseSchema.parse({ data: result, requestId, meta: {} });
  }

  @Post("changes/:changeId/apply")
  @HttpCode(200)
  @ApiBody({ schema: applyBodySchema })
  @ApiOkResponse({ description: "Applied change request", schema: applyResponseSchema })
  async apply(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("changeId") changeId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const result = await this.service.apply(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      uuidV7Schema.parse(changeId),
      changeApplyRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return changeApplyResponseSchema.parse({ data: result, requestId, meta: {} });
  }

  @Post("rollback")
  @HttpCode(200)
  @ApiBody({ schema: rollbackBodySchema })
  @ApiOkResponse({ description: "Appended rollback version node", schema: rollbackResponseSchema })
  async rollback(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const result = await this.service.rollback(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      versionRollbackRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return versionRollbackResponseSchema.parse({ data: result, requestId, meta: {} });
  }

  @Get("compare/:sourceBranchId")
  @ApiOkResponse({
    description: "Object-level branch comparison",
    schema: comparisonResponseSchema,
  })
  async compare(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") targetBranchId: string,
    @Param("sourceBranchId") sourceBranchId: string,
  ) {
    const requestId = createRequestId();
    const items = await this.service.compare(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(targetBranchId),
      uuidV7Schema.parse(sourceBranchId),
    );
    return branchComparisonResponseSchema.parse({
      data: {
        sourceBranchId: uuidV7Schema.parse(sourceBranchId),
        targetBranchId: uuidV7Schema.parse(targetBranchId),
        items,
      },
      requestId,
      meta: {},
    });
  }

  @Post("merge-items/:itemId/decision")
  @HttpCode(200)
  @ApiBody({ schema: decisionBodySchema })
  @ApiOkResponse({ description: "Recorded merge decision", schema: decisionResponseSchema })
  async decide(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const item = await this.service.decide(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(itemId),
      mergeItemDecisionRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return mergeItemDecisionResponseSchema.parse({ data: item, requestId, meta: {} });
  }

  @Post("merge-items/apply")
  @HttpCode(200)
  @ApiBody({ schema: mergeApplyBodySchema })
  @ApiOkResponse({ description: "Applied merge items", schema: mergeApplyResponseJsonSchema })
  async applyMerge(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const result = await this.service.applyMerge(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      mergeApplyRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return mergeApplyResponseSchema.parse({ data: result, requestId, meta: {} });
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

@ApiTags("changes")
@Controller("works/:workId/branches")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class BranchController {
  constructor(private readonly service: ChangesService) {}

  @Post()
  @HttpCode(200)
  @ApiBody({ schema: branchBodySchema })
  @ApiOkResponse({ description: "Created parallel branch", schema: branchResponseSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const branch = await this.service.createBranch(
      this.userId(request),
      uuidV7Schema.parse(workId),
      branchCreateRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return branchCreateResponseSchema.parse({ data: branch, requestId, meta: {} });
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
