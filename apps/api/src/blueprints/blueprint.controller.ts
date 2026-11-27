import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  blueprintEstimateQuerySchema,
  blueprintEstimateResponseSchema,
  uuidV7Schema,
  workBlueprintResponseSchema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { ApiOkResponse, ApiResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { ApiQuerySchema } from "../common/zod-openapi";
import { BlueprintService } from "./blueprint.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const estimateResponseJsonSchema = schemaOf(blueprintEstimateResponseSchema);
const workBlueprintResponseJsonSchema = schemaOf(workBlueprintResponseSchema);

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
    return workBlueprintResponseSchema.parse({
      data: await this.service.retry(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId: createRequestId(),
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
