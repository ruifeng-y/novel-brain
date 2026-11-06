import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import {
  generationReadinessQuerySchema,
  generationReadinessResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReadinessService } from "./readiness.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const readinessJsonSchema = schemaOf(generationReadinessResponseSchema);

@ApiTags("readiness")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ReadinessController {
  constructor(private readonly service: ReadinessService) {}

  @Get("readiness")
  @ApiOkResponse({
    description: "Versioned opening and chapter generation readiness",
    schema: readinessJsonSchema,
  })
  async readiness(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    return generationReadinessResponseSchema.parse({
      data: await this.service.evaluate(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        generationReadinessQuerySchema.parse(query),
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
