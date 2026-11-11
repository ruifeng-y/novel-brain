import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import {
  agentRunTraceListQuerySchema,
  agentRunTraceListResponseSchema,
  agentRunTraceResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiError } from "../common/api-error";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentTraceService } from "./agent-trace.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const traceJsonSchema = schemaOf(agentRunTraceResponseSchema);
const traceListJsonSchema = schemaOf(agentRunTraceListResponseSchema);

@ApiTags("agent-runtime")
@Controller("works/:workId/branches/:branchId/agent-runs")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class AgentTraceController {
  constructor(private readonly service: AgentTraceService) {}

  @Get()
  @ApiQuerySchema(agentRunTraceListQuerySchema)
  @ApiOkResponse({ description: "Tenant-scoped run traces", schema: traceListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const page = agentRunTraceListQuerySchema.parse(query ?? {});
    const result = await this.service.list(
      this.userId(request),
      {
        workId: uuidV7Schema.parse(workId),
        branchId: uuidV7Schema.parse(branchId),
      },
      {
        ...(page.chapterId ? { chapterId: page.chapterId } : {}),
        ...(page.jobId ? { jobId: page.jobId } : {}),
        ...(page.cursor ? { cursor: page.cursor } : {}),
        limit: page.limit,
      },
    );
    return agentRunTraceListResponseSchema.parse({
      data: result.traces,
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  }

  @Get(":runId")
  @ApiOkResponse({ description: "Run trace with replay metadata", schema: traceJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("runId") runId: string,
  ) {
    const requestId = createRequestId();
    return agentRunTraceResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        {
          workId: uuidV7Schema.parse(workId),
          branchId: uuidV7Schema.parse(branchId),
        },
        uuidV7Schema.parse(runId),
      ),
      requestId,
      meta: {},
    });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new ApiError(401, "AUTH_SESSION_INVALID", "登录状态已失效");
    }
    return request.auth.user.id;
  }
}
