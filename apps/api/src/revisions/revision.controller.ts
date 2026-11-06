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
  cursorPageQuerySchema,
  revisionFeedbackCreateRequestSchema,
  revisionPlanCreateRequestSchema,
  revisionPlanWorkspaceListResponseSchema,
  revisionPlanWorkspaceResponseSchema,
  revisionRoundCreateRequestSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import type { SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RevisionService } from "./revision.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const planBodySchema = schemaOf(revisionPlanCreateRequestSchema, "input");
const roundBodySchema = schemaOf(revisionRoundCreateRequestSchema, "input");
const feedbackBodySchema = schemaOf(revisionFeedbackCreateRequestSchema, "input");
const workspaceSchema = schemaOf(revisionPlanWorkspaceResponseSchema);
const workspaceListSchema = schemaOf(revisionPlanWorkspaceListResponseSchema);

@ApiTags("revisions")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class RevisionController {
  constructor(private readonly service: RevisionService) {}

  @Post("chapters/:chapterId/revisions")
  @HttpCode(202)
  @ApiBody({ schema: planBodySchema })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for replaying the same revision plan request",
  })
  @ApiAcceptedResponse({
    description: "Queued revision plan and first round",
    schema: workspaceSchema,
  })
  async createPlan(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return revisionPlanWorkspaceResponseSchema.parse({
      data: await this.service.createPlan(
        this.userId(request),
        this.context(workId, branchId, chapterId),
        idempotencyKey ?? "",
        revisionPlanCreateRequestSchema.parse(body ?? {}),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId/revisions")
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ description: "Revision plans for one chapter", schema: workspaceListSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const page = cursorPageQuerySchema.parse(query);
    const result = await this.service.list(
      this.userId(request),
      this.context(workId, branchId, chapterId),
      page,
    );
    return revisionPlanWorkspaceListResponseSchema.parse({
      data: result.plans,
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  }

  @Get("revisions/:revisionPlanId")
  @ApiOkResponse({ description: "Revision plan with rounds and feedback", schema: workspaceSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("revisionPlanId") revisionPlanId: string,
  ) {
    const requestId = createRequestId();
    return revisionPlanWorkspaceResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(revisionPlanId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("revisions/:revisionPlanId/rounds")
  @HttpCode(202)
  @ApiBody({ schema: roundBodySchema })
  @ApiAcceptedResponse({ description: "Queued next revision round", schema: workspaceSchema })
  async addRound(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("revisionPlanId") revisionPlanId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const planId = uuidV7Schema.parse(revisionPlanId);
    const context = this.branchContext(workId, branchId);
    return revisionPlanWorkspaceResponseSchema.parse({
      data: await this.service.addRound(
        this.userId(request),
        { ...context, chapterId: await this.chapterIdForPlan(request, workId, branchId, planId) },
        planId,
        revisionRoundCreateRequestSchema.parse(body ?? {}),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("revisions/:revisionPlanId/rounds/:roundId/feedback")
  @HttpCode(200)
  @ApiBody({ schema: feedbackBodySchema })
  @ApiOkResponse({ description: "Recorded author revision feedback", schema: workspaceSchema })
  async feedback(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("revisionPlanId") revisionPlanId: string,
    @Param("roundId") roundId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const planId = uuidV7Schema.parse(revisionPlanId);
    const context = this.branchContext(workId, branchId);
    return revisionPlanWorkspaceResponseSchema.parse({
      data: await this.service.feedback(
        this.userId(request),
        { ...context, chapterId: await this.chapterIdForPlan(request, workId, branchId, planId) },
        planId,
        uuidV7Schema.parse(roundId),
        revisionFeedbackCreateRequestSchema.parse(body ?? {}),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  private async chapterIdForPlan(
    request: AuthenticatedRequest,
    workId: string,
    branchId: string,
    planId: string,
  ): Promise<string> {
    const workspace = await this.service.get(
      this.userId(request),
      this.branchContext(workId, branchId),
      planId,
    );
    return workspace.plan.chapterId;
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }

  private context(workId: string, branchId: string, chapterId: string) {
    return {
      workId: uuidV7Schema.parse(workId),
      branchId: uuidV7Schema.parse(branchId),
      chapterId: uuidV7Schema.parse(chapterId),
    };
  }

  private branchContext(workId: string, branchId: string) {
    return {
      workId: uuidV7Schema.parse(workId),
      branchId: uuidV7Schema.parse(branchId),
    };
  }

  private audit(request: AuthenticatedRequest, requestId: string) {
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
    };
  }
}
