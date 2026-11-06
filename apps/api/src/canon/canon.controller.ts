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
  canonCommitListResponseSchema,
  canonCommitRequestSchema,
  canonCommitResponseSchema,
  cursorPageQuerySchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CanonService } from "./canon.service";

const requestJsonSchema = z.toJSONSchema(canonCommitRequestSchema, {
  target: "openapi-3.0",
  io: "input",
}) as SchemaObject;
const commitJsonSchema = z.toJSONSchema(canonCommitResponseSchema, {
  target: "openapi-3.0",
  io: "output",
}) as SchemaObject;
const commitListJsonSchema = z.toJSONSchema(canonCommitListResponseSchema, {
  target: "openapi-3.0",
  io: "output",
}) as SchemaObject;

@ApiTags("canon")
@Controller("works/:workId/branches/:branchId")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class CanonController {
  constructor(private readonly service: CanonService) {}

  @Post("chapters/:chapterId/canon/commit")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: requestJsonSchema })
  @ApiOkResponse({ description: "Submitted chapter facts", schema: commitJsonSchema })
  async submit(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    return canonCommitResponseSchema.parse({
      data: await this.service.submit(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
        canonCommitRequestSchema.parse(body ?? {}),
        normalizedKey,
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

  @Get("canon/commits")
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ description: "Canon commits", schema: commitListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const page = cursorPageQuerySchema.parse(query);
    const result = await this.service.list(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      page,
    );
    return canonCommitListResponseSchema.parse({
      data: result.commits,
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }
}
