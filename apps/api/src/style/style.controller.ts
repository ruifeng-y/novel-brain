import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  styleDriftCheckRequestSchema,
  styleDriftReportResponseSchema,
  styleDriftWorkspaceResponseSchema,
  styleProfileApproveRequestSchema,
  styleProfileCreateRequestSchema,
  styleProfileResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StyleService } from "./style.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const workspaceSchema = schemaOf(styleDriftWorkspaceResponseSchema);
const profileSchema = schemaOf(styleProfileResponseSchema);
const reportSchema = schemaOf(styleDriftReportResponseSchema);
const createProfileBodySchema = schemaOf(styleProfileCreateRequestSchema, "input");
const approveProfileBodySchema = schemaOf(styleProfileApproveRequestSchema, "input");
const checkDriftBodySchema = schemaOf(styleDriftCheckRequestSchema, "input");

@ApiTags("style")
@Controller("works/:workId/branches/:branchId/style")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class StyleController {
  constructor(private readonly service: StyleService) {}

  @Get()
  @ApiOkResponse({
    description: "Style baselines and latest drift reports",
    schema: workspaceSchema,
  })
  async workspace(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    return styleDriftWorkspaceResponseSchema.parse({
      data: await this.service.workspace(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("profiles")
  @HttpCode(201)
  @ApiBody({ schema: createProfileBodySchema })
  @ApiCreatedResponse({ description: "Created style profile", schema: profileSchema })
  async createProfile(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return styleProfileResponseSchema.parse({
      data: await this.service.createProfile(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        styleProfileCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("profiles/:profileId/approve")
  @HttpCode(200)
  @ApiBody({ schema: approveProfileBodySchema })
  @ApiOkResponse({ description: "Approved style profile", schema: profileSchema })
  async approveProfile(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("profileId") profileId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return styleProfileResponseSchema.parse({
      data: await this.service.approveProfile(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(profileId),
        styleProfileApproveRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("drift")
  @HttpCode(200)
  @ApiBody({ schema: checkDriftBodySchema })
  @ApiOkResponse({ description: "Persisted style drift report", schema: reportSchema })
  async checkDrift(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return styleDriftReportResponseSchema.parse({
      data: await this.service.checkDrift(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        styleDriftCheckRequestSchema.parse(body),
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
