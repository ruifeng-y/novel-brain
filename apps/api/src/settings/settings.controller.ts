import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
  settingEntityCreateRequestSchema,
  settingEntityDeleteResponseSchema,
  settingEntityListQuerySchema,
  settingEntityListResponseSchema,
  settingEntityLockRequestSchema,
  settingEntityPatchRequestSchema,
  settingEntityResponseSchema,
  settingChangeRequestCreateRequestSchema,
  settingChangeRequestListResponseSchema,
  settingChangeRequestResponseSchema,
  settingProposalCreateRequestSchema,
  settingProposalDecisionRequestSchema,
  settingProposalListResponseSchema,
  settingProposalResponseSchema,
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
import { SettingsService } from "./settings.service";

function schemaOf(schema: z.ZodType, io: "input" | "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const createBodyJsonSchema = schemaOf(settingEntityCreateRequestSchema, "input");
const patchBodyJsonSchema = schemaOf(settingEntityPatchRequestSchema, "input");
const lockBodyJsonSchema = schemaOf(settingEntityLockRequestSchema, "input");
const listResponseJsonSchema = schemaOf(settingEntityListResponseSchema, "output");
const entityResponseJsonSchema = schemaOf(settingEntityResponseSchema, "output");
const proposalResponseJsonSchema = schemaOf(settingProposalResponseSchema, "output");
const proposalListResponseJsonSchema = schemaOf(settingProposalListResponseSchema, "output");
const proposalCreateBodyJsonSchema = schemaOf(settingProposalCreateRequestSchema, "input");
const proposalDecisionBodyJsonSchema = schemaOf(settingProposalDecisionRequestSchema, "input");
const changeRequestResponseJsonSchema = schemaOf(settingChangeRequestResponseSchema, "output");
const changeRequestListResponseJsonSchema = schemaOf(
  settingChangeRequestListResponseSchema,
  "output",
);
const changeRequestBodyJsonSchema = schemaOf(settingChangeRequestCreateRequestSchema, "input");

@ApiTags("settings")
@Controller("works/:workId/branches/:branchId/entities")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @ApiOkResponse({ description: "Settings entities", schema: listResponseJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    return settingEntityListResponseSchema.parse({
      data: await this.service.list(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        settingEntityListQuerySchema.parse(query),
      ),
      requestId,
      meta: {},
    });
  }

  @Post()
  @HttpCode(201)
  @ApiBody({ schema: createBodyJsonSchema })
  @ApiCreatedResponse({ description: "Created setting", schema: entityResponseJsonSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return settingEntityResponseSchema.parse({
      data: await this.service.create(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        settingEntityCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get(":entityId")
  @ApiOkResponse({ description: "Setting detail", schema: entityResponseJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
  ) {
    const requestId = createRequestId();
    return settingEntityResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
      ),
      requestId,
      meta: {},
    });
  }

  @Patch(":entityId")
  @ApiBody({ schema: patchBodyJsonSchema })
  @ApiOkResponse({ description: "Updated setting", schema: entityResponseJsonSchema })
  async patch(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return settingEntityResponseSchema.parse({
      data: await this.service.patch(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
        settingEntityPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get(":entityId/proposals")
  @ApiOkResponse({
    description: "Setting proposal history",
    schema: proposalListResponseJsonSchema,
  })
  async proposals(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
  ) {
    const requestId = createRequestId();
    return settingProposalListResponseSchema.parse({
      data: await this.service.listProposals(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":entityId/proposals")
  @HttpCode(201)
  @ApiBody({ schema: proposalCreateBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Setting proposal",
    schema: proposalResponseJsonSchema,
  })
  async createProposal(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return settingProposalResponseSchema.parse({
      data: await this.service.createProposal(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
        settingProposalCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":entityId/proposals/:proposalId/decision")
  @HttpCode(200)
  @ApiBody({ schema: proposalDecisionBodyJsonSchema })
  @ApiOkResponse({
    description: "Decided setting proposal",
    schema: proposalResponseJsonSchema,
  })
  async decideProposal(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
    @Param("proposalId") proposalId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return settingProposalResponseSchema.parse({
      data: await this.service.decideProposal(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
        uuidV7Schema.parse(proposalId),
        settingProposalDecisionRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get(":entityId/change-requests")
  @ApiOkResponse({
    description: "Setting change request history",
    schema: changeRequestListResponseJsonSchema,
  })
  async changeRequests(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
  ) {
    const requestId = createRequestId();
    return settingChangeRequestListResponseSchema.parse({
      data: await this.service.listChangeRequests(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":entityId/change-requests")
  @HttpCode(201)
  @ApiBody({ schema: changeRequestBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Pending setting change request",
    schema: changeRequestResponseJsonSchema,
  })
  async createChangeRequest(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const requestId = createRequestId();
    return settingChangeRequestResponseSchema.parse({
      data: await this.service.createChangeRequest(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
        settingChangeRequestCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
        idempotencyKey?.trim() || undefined,
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":entityId/lock")
  @HttpCode(200)
  @ApiBody({ schema: lockBodyJsonSchema })
  @ApiOkResponse({ description: "Locked setting", schema: entityResponseJsonSchema })
  async lock(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return settingEntityResponseSchema.parse({
      data: await this.service.lock(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
        settingEntityLockRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Delete(":entityId")
  @ApiOkResponse({
    description: "Deleted setting",
    schema: schemaOf(settingEntityDeleteResponseSchema, "output"),
  })
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entityId") entityId: string,
  ) {
    const requestId = createRequestId();
    return settingEntityDeleteResponseSchema.parse({
      data: await this.service.remove(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entityId),
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
