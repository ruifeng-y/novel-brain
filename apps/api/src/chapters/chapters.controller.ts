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
  chapterCreateRequestSchema,
  chapterPatchRequestSchema,
  chapterReadinessResponseSchema,
  chapterVersionCreateRequestSchema,
  chapterVersionListResponseSchema,
  chapterVersionSaveResponseSchema,
  chapterWorkspaceListResponseSchema,
  chapterWorkspaceResponseSchema,
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
import { ChaptersService } from "./chapters.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const chapterListJsonSchema = schemaOf(chapterWorkspaceListResponseSchema);
const chapterJsonSchema = schemaOf(chapterWorkspaceResponseSchema);
const readinessJsonSchema = schemaOf(chapterReadinessResponseSchema);
const versionsJsonSchema = schemaOf(chapterVersionListResponseSchema);
const savedVersionJsonSchema = schemaOf(chapterVersionSaveResponseSchema);
const createBodyJsonSchema = schemaOf(chapterCreateRequestSchema, "input");
const patchBodyJsonSchema = schemaOf(chapterPatchRequestSchema, "input");
const saveVersionBodyJsonSchema = schemaOf(chapterVersionCreateRequestSchema, "input");

@ApiTags("chapters")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ChaptersController {
  constructor(private readonly service: ChaptersService) {}

  @Get("chapters")
  @ApiOkResponse({ description: "Ordered chapter briefs", schema: chapterListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return chapterWorkspaceListResponseSchema.parse({
      data: await this.service.list(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("chapters")
  @HttpCode(201)
  @ApiBody({ schema: createBodyJsonSchema })
  @ApiCreatedResponse({ description: "Planned chapter", schema: chapterJsonSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return chapterWorkspaceResponseSchema.parse({
      data: await this.service.create(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        chapterCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("outline/readiness")
  @ApiOkResponse({ description: "Chapter plan readiness", schema: readinessJsonSchema })
  async outlineReadiness(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return chapterReadinessResponseSchema.parse({
      data: await this.service.outlineReadiness(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId")
  @ApiOkResponse({ description: "Chapter workspace", schema: chapterJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
  ) {
    const requestId = createRequestId();
    return chapterWorkspaceResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
      ),
      requestId,
      meta: {},
    });
  }

  @Patch("chapters/:chapterId")
  @ApiBody({ schema: patchBodyJsonSchema })
  @ApiOkResponse({ description: "Updated chapter brief", schema: chapterJsonSchema })
  async patch(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return chapterWorkspaceResponseSchema.parse({
      data: await this.service.patch(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
        chapterPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId/readiness")
  @ApiOkResponse({ description: "Chapter readiness", schema: readinessJsonSchema })
  async readiness(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
  ) {
    const requestId = createRequestId();
    return chapterReadinessResponseSchema.parse({
      data: await this.service.chapterReadiness(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId/versions")
  @ApiOkResponse({ description: "Append-only chapter versions", schema: versionsJsonSchema })
  async versions(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
  ) {
    const requestId = createRequestId();
    return chapterVersionListResponseSchema.parse({
      data: await this.service.versions(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("chapters/:chapterId/versions")
  @HttpCode(201)
  @ApiBody({ schema: saveVersionBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Saved chapter version and resulting chapter",
    schema: savedVersionJsonSchema,
  })
  async saveVersion(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return chapterVersionSaveResponseSchema.parse({
      data: await this.service.saveVersion(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
        chapterVersionCreateRequestSchema.parse(body),
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
