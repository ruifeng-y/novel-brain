import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  factProposalDecisionRequestSchema,
  factProposalListResponseSchema,
  factProposalResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { ApiBody, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FactsService } from "./facts.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const decisionBodyJsonSchema = schemaOf(factProposalDecisionRequestSchema, "input");
const proposalListJsonSchema = schemaOf(factProposalListResponseSchema);
const proposalJsonSchema = schemaOf(factProposalResponseSchema);

@ApiTags("facts")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class FactsController {
  constructor(private readonly service: FactsService) {}

  @Post("chapters/:chapterId/extract-facts")
  @HttpCode(200)
  @ApiOkResponse({ description: "Extracted fact proposals", schema: proposalListJsonSchema })
  async extract(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
  ) {
    const requestId = createRequestId();
    return factProposalListResponseSchema.parse({
      data: await this.service.extract(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("chapters/:chapterId/fact-proposals")
  @ApiOkResponse({ description: "Chapter fact proposals", schema: proposalListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
  ) {
    const requestId = createRequestId();
    return factProposalListResponseSchema.parse({
      data: await this.service.list(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("fact-proposals/:factProposalId/decision")
  @HttpCode(200)
  @ApiBody({ schema: decisionBodyJsonSchema })
  @ApiOkResponse({ description: "Updated fact proposal", schema: proposalJsonSchema })
  async decide(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("factProposalId") factProposalId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return factProposalResponseSchema.parse({
      data: await this.service.decide(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(factProposalId),
        factProposalDecisionRequestSchema.parse(body ?? {}),
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
