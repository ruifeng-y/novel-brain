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
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import {
  storyLedgerDeleteRequestSchema,
  storyLedgerDeleteResponseSchema,
  storyLedgerEntryCreateRequestSchema,
  storyLedgerEntryPatchRequestSchema,
  storyLedgerLifecycleRequestSchema,
  storyLedgerMutationResponseSchema,
  storyLedgerWorkspaceResponseSchema,
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
import { StoryLedgerService } from "./story-ledger.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const workspaceJsonSchema = schemaOf(storyLedgerWorkspaceResponseSchema);
const mutationJsonSchema = schemaOf(storyLedgerMutationResponseSchema);
const deleteJsonSchema = schemaOf(storyLedgerDeleteResponseSchema);
const createBodyJsonSchema = schemaOf(storyLedgerEntryCreateRequestSchema, "input");
const patchBodyJsonSchema = schemaOf(storyLedgerEntryPatchRequestSchema, "input");
const lifecycleBodyJsonSchema = schemaOf(storyLedgerLifecycleRequestSchema, "input");
const deleteBodyJsonSchema = schemaOf(storyLedgerDeleteRequestSchema, "input");

@ApiTags("story-ledger")
@Controller("works/:workId/branches/:branchId/ledger")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class StoryLedgerController {
  constructor(private readonly service: StoryLedgerService) {}

  @Get()
  @ApiOkResponse({ description: "Story ledger workspace", schema: workspaceJsonSchema })
  async workspace(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    return storyLedgerWorkspaceResponseSchema.parse({
      data: await this.service.workspace(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("entries")
  @HttpCode(201)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: createBodyJsonSchema })
  @ApiCreatedResponse({ description: "Created ledger entry", schema: mutationJsonSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return storyLedgerMutationResponseSchema.parse({
      data: await this.service.create(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        storyLedgerEntryCreateRequestSchema.parse(body),
        idempotencyKey ?? "",
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Patch("entries/:entryId")
  @ApiBody({ schema: patchBodyJsonSchema })
  @ApiOkResponse({ description: "Updated ledger entry", schema: mutationJsonSchema })
  async patch(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return storyLedgerMutationResponseSchema.parse({
      data: await this.service.patch(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entryId),
        storyLedgerEntryPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("entries/:entryId/transitions")
  @HttpCode(200)
  @ApiBody({ schema: lifecycleBodyJsonSchema })
  @ApiOkResponse({ description: "Transitioned ledger entry", schema: mutationJsonSchema })
  async transition(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return storyLedgerMutationResponseSchema.parse({
      data: await this.service.transition(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entryId),
        storyLedgerLifecycleRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Delete("entries/:entryId")
  @HttpCode(200)
  @ApiBody({ schema: deleteBodyJsonSchema })
  @ApiOkResponse({ description: "Removed ledger entry", schema: deleteJsonSchema })
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = storyLedgerDeleteRequestSchema.parse(body);
    return storyLedgerDeleteResponseSchema.parse({
      data: await this.service.remove(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(entryId),
        input.version,
        input.reason,
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
