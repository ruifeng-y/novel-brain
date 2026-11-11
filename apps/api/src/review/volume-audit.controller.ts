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
  volumeAuditReportResponseSchema,
  volumeAuditRunRequestSchema,
  volumeAuditSignoffRequestSchema,
  volumeAuditWorkspaceResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
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
import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VolumeAuditService } from "./volume-audit.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const workspaceSchema = schemaOf(volumeAuditWorkspaceResponseSchema);
const reportSchema = schemaOf(volumeAuditReportResponseSchema);
const runBodySchema = schemaOf(volumeAuditRunRequestSchema, "input");
const signoffBodySchema = schemaOf(volumeAuditSignoffRequestSchema, "input");

@ApiTags("volume-audit")
@Controller("works/:workId/branches/:branchId/volume-audits")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class VolumeAuditController {
  constructor(private readonly service: VolumeAuditService) {}

  @Get()
  @ApiOkResponse({ description: "Volume audit workspace", schema: workspaceSchema })
  async workspace(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    return volumeAuditWorkspaceResponseSchema.parse({
      data: await this.service.workspace(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post()
  @HttpCode(201)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: runBodySchema })
  @ApiCreatedResponse({ description: "Volume audit report", schema: reportSchema })
  async run(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return volumeAuditReportResponseSchema.parse({
      data: await this.service.run(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        volumeAuditRunRequestSchema.parse(body),
        idempotencyKey ?? "",
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":auditId/signoff")
  @HttpCode(200)
  @ApiHeader({ name: "If-Match", required: false })
  @ApiBody({ schema: signoffBodySchema })
  @ApiOkResponse({ description: "Signed volume audit report", schema: reportSchema })
  async signoff(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("auditId") auditId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = volumeAuditSignoffRequestSchema.parse(body);
    if (ifMatch) {
      const expectedVersion = Number(ifMatch.replace(/[^0-9]/gu, ""));
      if (!Number.isInteger(expectedVersion) || expectedVersion !== input.version) {
        throw new ApiError(409, "VERSION_CONFLICT", "卷末审计报告已更新，请刷新后重试");
      }
    }
    return volumeAuditReportResponseSchema.parse({
      data: await this.service.signoff(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(auditId),
        input,
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
