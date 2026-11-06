import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import {
  outlineNodeCreateRequestSchema,
  outlineNodeMoveRequestSchema,
  outlineNodeMutationResponseSchema,
  outlineNodePatchRequestSchema,
  outlineNodeVersionRequestSchema,
  outlineReadinessResponseSchema,
  outlineReplanCheckRequestSchema,
  outlineReplanResponseSchema,
  outlineSceneCardWriteRequestSchema,
  outlineVolumeContractWriteRequestSchema,
  outlineWorkspaceResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { OutlineService } from "./outline.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const workspaceJsonSchema = schemaOf(outlineWorkspaceResponseSchema);
const mutationJsonSchema = schemaOf(outlineNodeMutationResponseSchema);
const readinessJsonSchema = schemaOf(outlineReadinessResponseSchema);
const replanJsonSchema = schemaOf(outlineReplanResponseSchema);
const createNodeBodyJsonSchema = schemaOf(outlineNodeCreateRequestSchema, "input");
const patchNodeBodyJsonSchema = schemaOf(outlineNodePatchRequestSchema, "input");
const moveNodeBodyJsonSchema = schemaOf(outlineNodeMoveRequestSchema, "input");
const nodeVersionBodyJsonSchema = schemaOf(outlineNodeVersionRequestSchema, "input");
const volumeContractBodyJsonSchema = schemaOf(outlineVolumeContractWriteRequestSchema, "input");
const sceneCardBodyJsonSchema = schemaOf(outlineSceneCardWriteRequestSchema, "input");
const replanBodyJsonSchema = schemaOf(outlineReplanCheckRequestSchema, "input");

@ApiTags("outline")
@Controller("works/:workId/branches/:branchId/outline")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class OutlineController {
  constructor(private readonly service: OutlineService) {}

  @Get()
  @ApiOkResponse({ description: "Five-level outline workspace", schema: workspaceJsonSchema })
  async workspace(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return outlineWorkspaceResponseSchema.parse({
      data: await this.service.workspace(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("planning-readiness")
  @ApiOkResponse({ description: "Structured outline readiness", schema: readinessJsonSchema })
  async readiness(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return outlineReadinessResponseSchema.parse({
      data: await this.service.readiness(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("nodes")
  @HttpCode(201)
  @ApiBody({ schema: createNodeBodyJsonSchema })
  @ApiCreatedResponse({ description: "Created outline node", schema: mutationJsonSchema })
  async createNode(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return outlineNodeMutationResponseSchema.parse({
      data: await this.service.createNode(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        outlineNodeCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Patch("nodes/:nodeId")
  @ApiBody({ schema: patchNodeBodyJsonSchema })
  @ApiOkResponse({ description: "Updated outline node", schema: mutationJsonSchema })
  async patchNode(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return outlineNodeMutationResponseSchema.parse({
      data: await this.service.patchNode(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(nodeId),
        outlineNodePatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("nodes/:nodeId/move")
  @HttpCode(200)
  @ApiBody({ schema: moveNodeBodyJsonSchema })
  @ApiOkResponse({ description: "Moved outline node", schema: mutationJsonSchema })
  async moveNode(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return outlineNodeMutationResponseSchema.parse({
      data: await this.service.moveNode(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(nodeId),
        outlineNodeMoveRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("nodes/:nodeId/lock")
  @HttpCode(200)
  @ApiBody({ schema: nodeVersionBodyJsonSchema })
  @ApiOkResponse({ description: "Locked outline node", schema: mutationJsonSchema })
  async lockNode(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = outlineNodeVersionRequestSchema.parse(body);
    return outlineNodeMutationResponseSchema.parse({
      data: await this.service.lockNode(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(nodeId),
        input.version,
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("nodes/:nodeId/unlock")
  @HttpCode(200)
  @ApiBody({ schema: nodeVersionBodyJsonSchema })
  @ApiOkResponse({ description: "Unlocked outline node", schema: mutationJsonSchema })
  async unlockNode(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = outlineNodeVersionRequestSchema.parse(body);
    return outlineNodeMutationResponseSchema.parse({
      data: await this.service.unlockNode(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(nodeId),
        input.version,
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Put("nodes/:nodeId/volume-contract")
  @ApiBody({ schema: volumeContractBodyJsonSchema })
  @ApiOkResponse({ description: "Saved volume contract", schema: mutationJsonSchema })
  async saveVolumeContract(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return outlineNodeMutationResponseSchema.parse({
      data: await this.service.saveVolumeContract(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(nodeId),
        outlineVolumeContractWriteRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Put("nodes/:nodeId/scene-card")
  @ApiBody({ schema: sceneCardBodyJsonSchema })
  @ApiOkResponse({ description: "Saved scene card", schema: mutationJsonSchema })
  async saveSceneCard(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return outlineNodeMutationResponseSchema.parse({
      data: await this.service.saveSceneCard(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(nodeId),
        outlineSceneCardWriteRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("replan-check")
  @HttpCode(200)
  @ApiBody({ schema: replanBodyJsonSchema })
  @ApiOkResponse({ description: "Structured re-planning impact", schema: replanJsonSchema })
  async replanCheck(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = outlineReplanCheckRequestSchema.parse(body);
    return outlineReplanResponseSchema.parse({
      data: await this.service.checkReplan(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        input.nodeId,
        input.proposedParentId,
        input.proposedSortOrder,
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
