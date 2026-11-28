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
  blueprintBudgetUpdateRequestSchema,
  blueprintCancelRequestSchema,
  blueprintConfirmRequestSchema,
  blueprintDraftPatchRequestSchema,
  blueprintEstimateQuerySchema,
  blueprintEstimateResponseSchema,
  uuidV7Schema,
  workBlueprintResponseSchema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { z } from "zod";

import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BlueprintService } from "./blueprint.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const estimateResponseJsonSchema = schemaOf(blueprintEstimateResponseSchema);
const workBlueprintResponseJsonSchema = schemaOf(workBlueprintResponseSchema);
const draftPatchRequestJsonSchema = schemaOf(blueprintDraftPatchRequestSchema, "input");
const budgetUpdateRequestJsonSchema = schemaOf(blueprintBudgetUpdateRequestSchema, "input");
const cancelRequestJsonSchema = schemaOf(blueprintCancelRequestSchema, "input");
const confirmRequestJsonSchema = schemaOf(blueprintConfirmRequestSchema, "input");

@ApiTags("blueprints")
@Controller()
@UseGuards(SessionAuthGuard, CsrfGuard)
export class BlueprintController {
  constructor(private readonly service: BlueprintService) {}

  @Get("blueprint-estimates")
  @ApiQuerySchema(blueprintEstimateQuerySchema)
  @ApiOkResponse({ description: "Estimated blueprint budget", schema: estimateResponseJsonSchema })
  async estimate(@Query() query: unknown) {
    return blueprintEstimateResponseSchema.parse({
      data: this.service.estimate(blueprintEstimateQuerySchema.parse(query ?? {})),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Get("works/:workId/branches/:branchId/blueprint")
  @ApiOkResponse({ description: "Work blueprint", schema: workBlueprintResponseJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    return workBlueprintResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("works/:workId/branches/:branchId/blueprint/retry")
  @HttpCode(202)
  @ApiResponse({
    status: 202,
    description: "Blueprint delivery retried",
    schema: workBlueprintResponseJsonSchema,
  })
  async retry(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return workBlueprintResponseSchema.parse({
      data: await this.service.retry(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        {
          requestId,
          ip: getClientIp(request) || "unknown",
          userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
        },
      ),
      requestId,
      meta: {},
    });
  }

  @Patch("works/:workId/branches/:branchId/blueprint/draft")
  @ApiBody({ schema: draftPatchRequestJsonSchema })
  @ApiOkResponse({ description: "Updated work blueprint", schema: workBlueprintResponseJsonSchema })
  async patchDraft(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return workBlueprintResponseSchema.parse({
      data: await this.service.patchDraft(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        blueprintDraftPatchRequestSchema.parse(body),
        {
          requestId,
          ip: getClientIp(request) || "unknown",
          userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
        },
      ),
      requestId,
      meta: {},
    });
  }

  @Post("works/:workId/branches/:branchId/blueprint/budget")
  @HttpCode(202)
  @ApiBody({ schema: budgetUpdateRequestJsonSchema })
  @ApiResponse({
    status: 202,
    description: "Work blueprint resumed with a higher budget",
    schema: workBlueprintResponseJsonSchema,
  })
  async updateBudget(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return workBlueprintResponseSchema.parse({
      data: await this.service.updateBudget(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        blueprintBudgetUpdateRequestSchema.parse(body),
        {
          requestId,
          ip: getClientIp(request) || "unknown",
          userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
        },
      ),
      requestId,
      meta: {},
    });
  }

  @Post("works/:workId/branches/:branchId/blueprint/cancel")
  @HttpCode(200)
  @ApiBody({ schema: cancelRequestJsonSchema })
  @ApiOkResponse({
    description: "Cancelled work blueprint",
    schema: workBlueprintResponseJsonSchema,
  })
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return workBlueprintResponseSchema.parse({
      data: await this.service.cancel(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        blueprintCancelRequestSchema.parse(body),
        {
          requestId,
          ip: getClientIp(request) || "unknown",
          userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
        },
      ),
      requestId,
      meta: {},
    });
  }

  @Post("works/:workId/branches/:branchId/blueprint/confirm")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiBody({ schema: confirmRequestJsonSchema })
  @ApiOkResponse({
    description: "Confirmed work blueprint",
    schema: workBlueprintResponseJsonSchema,
  })
  async confirm(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const requestId = createRequestId();
    return workBlueprintResponseSchema.parse({
      data: await this.service.confirm(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        blueprintConfirmRequestSchema.parse(body),
        idempotencyKey?.trim() || undefined,
        {
          requestId,
          ip: getClientIp(request) || "unknown",
          userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
        },
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
}
