import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  moderationAppealRequestSchema,
  moderationCaseListQuerySchema,
  moderationCaseListResponseSchema,
  moderationCaseResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ModerationService } from "./moderation.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output") {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const appealRequestJsonSchema = schemaOf(moderationAppealRequestSchema, "input");
const caseJsonSchema = schemaOf(moderationCaseResponseSchema);
const caseListJsonSchema = schemaOf(moderationCaseListResponseSchema);

@ApiTags("moderation")
@Controller("works/:workId/branches/:branchId/moderation-cases")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ModerationController {
  constructor(private readonly service: ModerationService) {}

  @Get()
  @ApiQuerySchema(moderationCaseListQuerySchema)
  @ApiOkResponse({
    description: "Content safety and appeal audit history",
    schema: caseListJsonSchema,
  })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const result = await this.service.list(
      this.userId(request),
      this.context(workId, branchId),
      moderationCaseListQuerySchema.parse(query ?? {}),
    );
    return moderationCaseListResponseSchema.parse({
      data: result.cases,
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  }

  @Post(":caseId/appeals")
  @HttpCode(201)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for replaying the same appeal submission",
  })
  @ApiBody({ schema: appealRequestJsonSchema })
  @ApiCreatedResponse({ description: "Updated moderation case", schema: caseJsonSchema })
  async submitAppeal(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("caseId") caseId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return moderationCaseResponseSchema.parse({
      data: await this.service.submitAppeal(
        this.userId(request),
        this.context(workId, branchId),
        uuidV7Schema.parse(caseId),
        moderationAppealRequestSchema.parse(body ?? {}),
        idempotencyKey ?? "",
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":caseId/appeals/:appealId/withdraw")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Withdrawn appeal and updated moderation case",
    schema: caseJsonSchema,
  })
  async withdrawAppeal(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("caseId") caseId: string,
    @Param("appealId") appealId: string,
  ) {
    const requestId = createRequestId();
    return moderationCaseResponseSchema.parse({
      data: await this.service.withdrawAppeal(
        this.userId(request),
        this.context(workId, branchId),
        uuidV7Schema.parse(caseId),
        uuidV7Schema.parse(appealId),
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

  private context(workId: string, branchId: string) {
    return {
      workId: uuidV7Schema.parse(workId),
      branchId: uuidV7Schema.parse(branchId),
    };
  }
}
