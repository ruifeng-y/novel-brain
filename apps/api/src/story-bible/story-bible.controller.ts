import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  storyBibleGenerateRequestSchema,
  storyBibleLockRequestSchema,
  storyBiblePatchRequestSchema,
  storyBibleReadinessResponseSchema,
  storyBibleResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StoryBibleService } from "./story-bible.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const storyBibleResponseJsonSchema = schemaOf(storyBibleResponseSchema);
const storyBibleReadinessResponseJsonSchema = schemaOf(storyBibleReadinessResponseSchema);

@ApiTags("story-bible")
@Controller("works/:workId/branches/:branchId/story-bible")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class StoryBibleController {
  constructor(private readonly service: StoryBibleService) {}

  @Get()
  @ApiOkResponse({ description: "Nine-card story bible", schema: storyBibleResponseJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return storyBibleResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("readiness")
  @ApiOkResponse({
    description: "Story bible readiness",
    schema: storyBibleReadinessResponseJsonSchema,
  })
  async readiness(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return storyBibleReadinessResponseSchema.parse({
      data: await this.service.readiness(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("generate")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Generated story bible proposal",
    schema: storyBibleResponseJsonSchema,
  })
  async generate(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    storyBibleGenerateRequestSchema.parse(body ?? {});
    return storyBibleResponseSchema.parse({
      data: await this.service.generate(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
      ),
      requestId,
      meta: {},
    });
  }

  @Patch()
  @ApiOkResponse({ description: "Updated story bible cards", schema: storyBibleResponseJsonSchema })
  async patch(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return storyBibleResponseSchema.parse({
      data: await this.service.patch(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        storyBiblePatchRequestSchema.parse(body),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("lock")
  @HttpCode(200)
  @ApiOkResponse({ description: "Locked story bible", schema: storyBibleResponseJsonSchema })
  async lock(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return storyBibleResponseSchema.parse({
      data: await this.service.lock(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        storyBibleLockRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Delete("cards/:cardKey")
  async deleteCard(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    return this.service.rejectDirectDelete(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
    );
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
