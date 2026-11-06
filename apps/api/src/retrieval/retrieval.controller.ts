import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import {
  retrievalQuerySchema,
  retrievalResultListResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RetrievalService } from "./retrieval.service";

function schemaOf(schema: z.ZodType, io: "input" | "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const queryBodyJsonSchema = schemaOf(retrievalQuerySchema, "input");
const responseJsonSchema = schemaOf(retrievalResultListResponseSchema, "output");

@ApiTags("retrieval")
@Controller("works/:workId/branches/:branchId/retrieval")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class RetrievalController {
  constructor(private readonly service: RetrievalService) {}

  @Post("search")
  @HttpCode(200)
  @ApiBody({ schema: queryBodyJsonSchema })
  @ApiOkResponse({ description: "Structured retrieval results", schema: responseJsonSchema })
  async search(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const userId = this.userId(request);
    const result = await this.service.search(
      userId,
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      retrievalQuerySchema.parse(body),
    );
    return retrievalResultListResponseSchema.parse({
      data: result.results,
      requestId: createRequestId(),
      meta: { tookMs: result.tookMs },
    });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }
}
