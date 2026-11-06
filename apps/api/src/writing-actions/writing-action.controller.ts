import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  type MessageEvent,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  writingActionJobListResponseSchema,
  writingActionJobResponseSchema,
  writingActionRequestSchema,
  uuidV7Schema,
  type JobEvent,
} from "@novel-brain/contracts";
import {
  ApiAcceptedResponse,
  ApiBody,
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
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WritingActionService } from "./writing-action.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const actionBodyJsonSchema = schemaOf(writingActionRequestSchema, "input");
const jobJsonSchema = schemaOf(writingActionJobResponseSchema);
const jobListJsonSchema = schemaOf(writingActionJobListResponseSchema);

@ApiTags("writing-actions")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class WritingActionController {
  constructor(private readonly service: WritingActionService) {}

  @Post("chapters/:chapterId/write-actions")
  @HttpCode(202)
  @ApiBody({ schema: actionBodyJsonSchema })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for replaying the same writing action request",
  })
  @ApiAcceptedResponse({ description: "Queued writing action", schema: jobJsonSchema })
  async start(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return writingActionJobResponseSchema.parse({
      data: await this.service.start(
        this.userId(request),
        this.context(workId, branchId, chapterId),
        idempotencyKey ?? "",
        writingActionRequestSchema.parse(body ?? {}),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId/write-actions")
  @ApiOkResponse({ description: "Writing actions for one chapter", schema: jobListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
  ) {
    const requestId = createRequestId();
    return writingActionJobListResponseSchema.parse({
      data: await this.service.list(
        this.userId(request),
        this.context(workId, branchId, chapterId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("write-actions/:actionJobId")
  @ApiOkResponse({ description: "Writing action and versioned output", schema: jobJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("actionJobId") actionJobId: string,
  ) {
    const requestId = createRequestId();
    return writingActionJobResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(actionJobId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("write-actions/:actionJobId/cancel")
  @HttpCode(200)
  @ApiOkResponse({ description: "Cancelled writing action", schema: jobJsonSchema })
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("actionJobId") actionJobId: string,
  ) {
    const requestId = createRequestId();
    return writingActionJobResponseSchema.parse({
      data: await this.service.cancel(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(actionJobId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("write-actions/:actionJobId/retry")
  @HttpCode(202)
  @ApiAcceptedResponse({ description: "Retried writing action", schema: jobJsonSchema })
  async retry(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("actionJobId") actionJobId: string,
  ) {
    const requestId = createRequestId();
    return writingActionJobResponseSchema.parse({
      data: await this.service.retry(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(actionJobId),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Sse("write-actions/:actionJobId/events")
  events(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("actionJobId") actionJobId: string,
    @Headers("last-event-id") lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.service
      .streamEvents(
        this.userId(request),
        this.branchContext(workId, branchId),
        uuidV7Schema.parse(actionJobId),
        lastEventId ? uuidV7Schema.parse(lastEventId) : undefined,
      )
      .pipe(
        map((event: JobEvent) => ({
          id: event.eventId,
          type: event.type,
          data: event,
        })),
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
