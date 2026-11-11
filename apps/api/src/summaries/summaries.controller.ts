import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  summaryRebuildRequestSchema,
  summaryRebuildRunResponseSchema,
  summaryWorkspaceResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SummariesService } from "./summaries.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const workspaceJsonSchema = schemaOf(summaryWorkspaceResponseSchema);
const runJsonSchema = schemaOf(summaryRebuildRunResponseSchema);
const rebuildBodyJsonSchema = schemaOf(summaryRebuildRequestSchema, "input");

@ApiTags("summaries")
@Controller("works/:workId/branches/:branchId/summaries")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class SummariesController {
  constructor(private readonly service: SummariesService) {}

  @Get()
  @ApiOkResponse({ description: "Hierarchical summary workspace", schema: workspaceJsonSchema })
  async workspace(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return summaryWorkspaceResponseSchema.parse({
      data: await this.service.workspace(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("rebuild")
  @HttpCode(202)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: rebuildBodyJsonSchema })
  @ApiOkResponse({ description: "Queued summary rebuild", schema: runJsonSchema })
  async rebuild(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    return summaryRebuildRunResponseSchema.parse({
      data: await this.service.rebuild(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        summaryRebuildRequestSchema.parse(body ?? {}),
        normalizedKey,
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("rebuilds/:runId")
  @ApiOkResponse({ description: "Summary rebuild checkpoint status", schema: runJsonSchema })
  async rebuildRun(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("runId") runId: string,
  ) {
    const requestId = createRequestId();
    return summaryRebuildRunResponseSchema.parse({
      data: await this.service.rebuildRun(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(runId),
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

  private audit(request: AuthenticatedRequest, requestId: string) {
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
    };
  }
}
