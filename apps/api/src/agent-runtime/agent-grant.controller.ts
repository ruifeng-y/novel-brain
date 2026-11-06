import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  agentGrantCreateRequestSchema,
  agentGrantListResponseSchema,
  agentGrantResponseSchema,
  agentGrantRevokeRequestSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentGrantService } from "./agent-grant.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const createBodySchema = schemaOf(agentGrantCreateRequestSchema, "input");
const revokeBodySchema = schemaOf(agentGrantRevokeRequestSchema, "input");
const grantResponseSchema = schemaOf(agentGrantResponseSchema);
const grantListResponseSchema = schemaOf(agentGrantListResponseSchema);

@ApiTags("agent-runtime")
@Controller("works/:workId/branches/:branchId/agent-grants")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class AgentGrantController {
  constructor(private readonly service: AgentGrantService) {}

  @Post()
  @ApiBody({ schema: createBodySchema })
  @ApiCreatedResponse({ description: "Issued agent grant", schema: grantResponseSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return agentGrantResponseSchema.parse({
      data: await this.service.create(
        this.userId(request),
        this.scope(workId, branchId),
        agentGrantCreateRequestSchema.parse(body),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get()
  @ApiOkResponse({ description: "Agent grants for the branch", schema: grantListResponseSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return agentGrantListResponseSchema.parse({
      data: await this.service.list(this.userId(request), this.scope(workId, branchId)),
      requestId,
      meta: {},
    });
  }

  @Get(":grantId")
  @ApiOkResponse({ description: "Agent grant", schema: grantResponseSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("grantId") grantId: string,
  ) {
    const requestId = createRequestId();
    return agentGrantResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        this.scope(workId, branchId),
        uuidV7Schema.parse(grantId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":grantId/revoke")
  @HttpCode(200)
  @ApiBody({ schema: revokeBodySchema })
  @ApiOkResponse({ description: "Revoked agent grant", schema: grantResponseSchema })
  async revoke(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("grantId") grantId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return agentGrantResponseSchema.parse({
      data: await this.service.revoke(
        this.userId(request),
        this.scope(workId, branchId),
        uuidV7Schema.parse(grantId),
        agentGrantRevokeRequestSchema.parse(body),
        this.audit(request, requestId),
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

  private scope(workId: string, branchId: string) {
    return {
      workId: uuidV7Schema.parse(workId),
      branchId: uuidV7Schema.parse(branchId),
    };
  }

  private audit(request: AuthenticatedRequest, requestId: string) {
    const userAgent = String(request.headers["user-agent"] ?? "").trim();
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: userAgent || "unknown",
    };
  }
}
