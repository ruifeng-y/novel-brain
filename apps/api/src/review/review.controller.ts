import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  chapterReviewRequestSchema,
  chapterReviewResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { ApiBody, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewService } from "./review.service";

const reviewBodyJsonSchema = z.toJSONSchema(chapterReviewRequestSchema, {
  target: "openapi-3.0",
  io: "input",
}) as SchemaObject;
const reviewResponseJsonSchema = z.toJSONSchema(chapterReviewResponseSchema, {
  target: "openapi-3.0",
  io: "output",
}) as SchemaObject;

@ApiTags("review")
@Controller("works/:workId/branches/:branchId/chapters/:chapterId/review")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Post()
  @HttpCode(200)
  @ApiBody({ schema: reviewBodyJsonSchema })
  @ApiOkResponse({ description: "Chapter review decision", schema: reviewResponseJsonSchema })
  async review(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("chapterId") chapterId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return chapterReviewResponseSchema.parse({
      data: await this.service.review(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(chapterId),
        chapterReviewRequestSchema.parse(body ?? {}),
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
