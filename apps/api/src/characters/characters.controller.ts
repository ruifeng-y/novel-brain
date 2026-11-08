import {
  Body,
  Controller,
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
  characterChangeRequestCreateRequestSchema,
  characterChangeRequestListResponseSchema,
  characterChangeRequestResponseSchema,
  characterCreateRequestSchema,
  characterDetailResponseSchema,
  characterHistoryQuerySchema,
  characterHistoryResponseSchema,
  characterKnowledgeProjectionQuerySchema,
  characterKnowledgeProjectionResponseSchema,
  characterKnowledgeStateCreateRequestSchema,
  characterKnowledgeStateResponseSchema,
  characterListResponseSchema,
  characterProfileUpdateRequestSchema,
  characterRelationshipCreateRequestSchema,
  characterRelationshipResponseSchema,
  characterStateTransitionCreateRequestSchema,
  characterStateTransitionResponseSchema,
  settingEntityLockRequestSchema,
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
import { CharactersService } from "./characters.service";

function schemaOf(schema: z.ZodType, io: "input" | "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const createBodyJsonSchema = schemaOf(characterCreateRequestSchema, "input");
const profileBodyJsonSchema = schemaOf(characterProfileUpdateRequestSchema, "input");
const relationshipBodyJsonSchema = schemaOf(characterRelationshipCreateRequestSchema, "input");
const stateBodyJsonSchema = schemaOf(characterStateTransitionCreateRequestSchema, "input");
const knowledgeBodyJsonSchema = schemaOf(characterKnowledgeStateCreateRequestSchema, "input");
const lockBodyJsonSchema = schemaOf(settingEntityLockRequestSchema, "input");
const changeRequestBodyJsonSchema = schemaOf(characterChangeRequestCreateRequestSchema, "input");
const detailResponseJsonSchema = schemaOf(characterDetailResponseSchema, "output");
const listResponseJsonSchema = schemaOf(characterListResponseSchema, "output");
const relationshipResponseJsonSchema = schemaOf(characterRelationshipResponseSchema, "output");
const stateResponseJsonSchema = schemaOf(characterStateTransitionResponseSchema, "output");
const knowledgeResponseJsonSchema = schemaOf(characterKnowledgeStateResponseSchema, "output");
const knowledgeProjectionResponseJsonSchema = schemaOf(
  characterKnowledgeProjectionResponseSchema,
  "output",
);
const historyResponseJsonSchema = schemaOf(characterHistoryResponseSchema, "output");
const changeRequestResponseJsonSchema = schemaOf(characterChangeRequestResponseSchema, "output");
const changeRequestListResponseJsonSchema = schemaOf(
  characterChangeRequestListResponseSchema,
  "output",
);

@ApiTags("characters")
@Controller("works/:workId/branches/:branchId/characters")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class CharactersController {
  constructor(private readonly service: CharactersService) {}

  @Get()
  @ApiOkResponse({ description: "Character domain details", schema: listResponseJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    return characterListResponseSchema.parse({
      data: await this.service.list(
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
  @ApiBody({ schema: createBodyJsonSchema })
  @ApiCreatedResponse({ description: "Created character", schema: detailResponseJsonSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return characterDetailResponseSchema.parse({
      data: await this.service.create(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        characterCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get(":characterId")
  @ApiOkResponse({ description: "Character detail", schema: detailResponseJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
  ) {
    return characterDetailResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Patch(":characterId")
  @ApiBody({ schema: profileBodyJsonSchema })
  @ApiOkResponse({ description: "Updated character profile", schema: detailResponseJsonSchema })
  async updateProfile(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return characterDetailResponseSchema.parse({
      data: await this.service.updateProfile(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
        characterProfileUpdateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":characterId/lock")
  @HttpCode(200)
  @ApiBody({ schema: lockBodyJsonSchema })
  @ApiOkResponse({ description: "Locked character", schema: detailResponseJsonSchema })
  async lock(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = settingEntityLockRequestSchema.parse(body);
    return characterDetailResponseSchema.parse({
      data: await this.service.lock(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
        input.version,
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":characterId/relationships")
  @HttpCode(201)
  @ApiBody({ schema: relationshipBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Created character relationship",
    schema: relationshipResponseJsonSchema,
  })
  async addRelationship(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return characterRelationshipResponseSchema.parse({
      data: await this.service.addRelationship(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
        characterRelationshipCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":characterId/state-transitions")
  @HttpCode(201)
  @ApiBody({ schema: stateBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Created character state transition",
    schema: stateResponseJsonSchema,
  })
  async addStateTransition(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return characterStateTransitionResponseSchema.parse({
      data: await this.service.addStateTransition(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
        characterStateTransitionCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":characterId/knowledge-states")
  @HttpCode(201)
  @ApiBody({ schema: knowledgeBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Created character knowledge state",
    schema: knowledgeResponseJsonSchema,
  })
  async addKnowledgeState(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return characterKnowledgeStateResponseSchema.parse({
      data: await this.service.addKnowledgeState(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
        characterKnowledgeStateCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get(":characterId/knowledge")
  @ApiOkResponse({
    description: "Objective facts disclosed to a character at a chapter",
    schema: knowledgeProjectionResponseJsonSchema,
  })
  async knowledge(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
    @Query() query: unknown,
  ) {
    const input = characterKnowledgeProjectionQuerySchema.parse(query);
    return characterKnowledgeProjectionResponseSchema.parse({
      data: await this.service.knowledge(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
        input.chapterNumber,
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Get(":characterId/history")
  @ApiOkResponse({ description: "Character state replay", schema: historyResponseJsonSchema })
  async history(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
    @Query() query: unknown,
  ) {
    return characterHistoryResponseSchema.parse({
      data: await this.service.history(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
        characterHistoryQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Get(":characterId/change-requests")
  @ApiOkResponse({
    description: "Character change requests",
    schema: changeRequestListResponseJsonSchema,
  })
  async changeRequests(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
  ) {
    return characterChangeRequestListResponseSchema.parse({
      data: await this.service.listChangeRequests(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post(":characterId/change-requests")
  @HttpCode(201)
  @ApiBody({ schema: changeRequestBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Pending character change request",
    schema: changeRequestResponseJsonSchema,
  })
  async createChangeRequest(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("characterId") characterId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const requestId = createRequestId();
    return characterChangeRequestResponseSchema.parse({
      data: await this.service.createChangeRequest(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(characterId),
        characterChangeRequestCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
        idempotencyKey?.trim() || undefined,
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
