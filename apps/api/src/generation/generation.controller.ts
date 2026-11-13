import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  type MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  contextPackPreviewResponseSchema,
  generateChapterRequestSchema,
  generationJobListQuerySchema,
  generationJobListResponseSchema,
  generationJobResponseSchema,
  jobRecoveryRequestSchema,
  jobRecoveryResponseSchema,
  uuidV7Schema,
  type JobEvent,
} from "@novel-brain/contracts";
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { map, type Observable } from "rxjs";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { sanitizeJobEventForDelivery } from "../logging/safe-job-event";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GenerationService } from "./generation.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const generateBodyJsonSchema = schemaOf(generateChapterRequestSchema, "input");
const jobJsonSchema = schemaOf(generationJobResponseSchema);
const jobListJsonSchema = schemaOf(generationJobListResponseSchema);
const contextPreviewJsonSchema = schemaOf(contextPackPreviewResponseSchema);
const recoveryBodyJsonSchema = schemaOf(jobRecoveryRequestSchema, "input");
const recoveryResponseJsonSchema = schemaOf(jobRecoveryResponseSchema);

@ApiTags("generation")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class GenerationController {
  constructor(private readonly service: GenerationService) {}

  @Post("chapters/:chapterId/generate")
  @HttpCode(202)
  @ApiBody({ schema: generateBodyJsonSchema })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for replaying the same chapter generation request",
  })
  @ApiAcceptedResponse({ description: "Queued chapter generation job", schema: jobJsonSchema })
  @ApiConflictResponse({
    description: "Generation readiness blockers must be resolved before queueing",
  })
  async start(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return generationJobResponseSchema.parse({
      data: await this.service.start(
        this.userId(request),
        this.context(workId, branchId, chapterId),
        idempotencyKey ?? "",
        generateChapterRequestSchema.parse(body ?? {}),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId/context-preview")
  @ApiOkResponse({
    description: "Compiled chapter context preview",
    schema: contextPreviewJsonSchema,
  })
  async contextPreview(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Query("tokenBudget") tokenBudget?: string,
  ) {
    const requestId = createRequestId();
    return contextPackPreviewResponseSchema.parse({
      data: await this.service.contextPreview(
        this.userId(request),
        this.context(workId, branchId, chapterId),
        tokenBudget ? z.coerce.number().int().positive().parse(tokenBudget) : 30_000,
      ),
      requestId,
      meta: {},
    });
  }

  @Get("jobs")
  @ApiQuerySchema(generationJobListQuerySchema)
  @ApiOkResponse({ description: "Chapter generation jobs", schema: jobListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const pageQuery = generationJobListQuerySchema.parse(query ?? {});
    const page = await this.service.list(
      this.userId(request),
      this.context(workId, branchId, pageQuery.chapterId),
      pageQuery,
    );
    return generationJobListResponseSchema.parse({
      data: page.data,
      requestId,
      meta: { nextCursor: page.nextCursor },
    });
  }

  @Get("jobs/:jobId")
  @ApiOkResponse({ description: "Generation job and checkpoint", schema: jobJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("jobId") jobId: string,
  ) {
    const requestId = createRequestId();
    return generationJobResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(jobId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("jobs/:jobId/cancel")
  @HttpCode(200)
  @ApiOkResponse({ description: "Cancelled generation job", schema: jobJsonSchema })
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("jobId") jobId: string,
  ) {
    const requestId = createRequestId();
    return generationJobResponseSchema.parse({
      data: await this.service.cancel(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(jobId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("jobs/:jobId/retry")
  @HttpCode(202)
  @ApiAcceptedResponse({ description: "Retried generation job", schema: jobJsonSchema })
  async retry(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("jobId") jobId: string,
  ) {
    const requestId = createRequestId();
    return generationJobResponseSchema.parse({
      data: await this.service.retry(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(jobId),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("jobs/:jobId/recover")
  @HttpCode(202)
  @ApiBody({ schema: recoveryBodyJsonSchema })
  @ApiAcceptedResponse({
    description: "Recovered generation job with an audit record",
    schema: recoveryResponseJsonSchema,
  })
  async recover(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return jobRecoveryResponseSchema.parse({
      data: await this.service.recover(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(jobId),
        jobRecoveryRequestSchema.parse(body ?? {}),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Sse("jobs/:jobId/events")
  events(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("jobId") jobId: string,
    @Headers("last-event-id") lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.service
      .streamEvents(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(jobId),
        lastEventId ? uuidV7Schema.parse(lastEventId) : undefined,
      )
      .pipe(
        map((event: JobEvent) => {
          const safeEvent = sanitizeJobEventForDelivery(event);
          return {
            id: safeEvent.eventId,
            type: safeEvent.type,
            data: safeEvent,
          };
        }),
      );
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
