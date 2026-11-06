import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  criticAnnotationListResponseSchema,
  criticAnnotationPatchRequestSchema,
  criticAnnotationResponseSchema,
  criticVerifyRequestSchema,
  qualityWorkspaceResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { ApiBody, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QualityService } from "./quality.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const verifyBodySchema = schemaOf(criticVerifyRequestSchema, "input");
const workspaceSchema = schemaOf(qualityWorkspaceResponseSchema);
const annotationsSchema = schemaOf(criticAnnotationListResponseSchema);
const annotationSchema = schemaOf(criticAnnotationResponseSchema);
const patchBodySchema = schemaOf(criticAnnotationPatchRequestSchema, "input");

@ApiTags("quality")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class QualityController {
  constructor(private readonly service: QualityService) {}

  @Post("chapters/:chapterId/verify")
  @HttpCode(200)
  @ApiBody({ schema: verifyBodySchema })
  @ApiOkResponse({ description: "Six-dimension critic report", schema: workspaceSchema })
  async verify(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return qualityWorkspaceResponseSchema.parse({
      data: await this.service.verify(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
        criticVerifyRequestSchema.parse(body ?? {}),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId/quality")
  @ApiOkResponse({ description: "Latest chapter quality report", schema: workspaceSchema })
  async quality(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
  ) {
    const requestId = createRequestId();
    return qualityWorkspaceResponseSchema.parse({
      data: await this.service.workspace(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId/annotations")
  @ApiOkResponse({ description: "Structured critic annotations", schema: annotationsSchema })
  async annotations(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
  ) {
    const requestId = createRequestId();
    return criticAnnotationListResponseSchema.parse({
      data: await this.service.annotations(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
      ),
      requestId,
      meta: {},
    });
  }

  @Patch("annotations/:annotationId")
  @ApiBody({ schema: patchBodySchema })
  @ApiOkResponse({ description: "Updated critic annotation", schema: annotationSchema })
  async patchAnnotation(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("annotationId") annotationId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return criticAnnotationResponseSchema.parse({
      data: await this.service.updateAnnotation(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(annotationId),
        criticAnnotationPatchRequestSchema.parse(body ?? {}),
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
