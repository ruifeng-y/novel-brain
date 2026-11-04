import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  uuidV7Schema,
  workBranchesResponseSchema,
  workCreateRequestSchema,
  workListQuerySchema,
  workListResponseSchema,
  workResponseSchema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksService } from "./works.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const createBodySchema = schemaOf(workCreateRequestSchema);
const workResponseJsonSchema = schemaOf(workResponseSchema);
const worksResponseJsonSchema = schemaOf(workListResponseSchema);
const branchesResponseJsonSchema = schemaOf(workBranchesResponseSchema);

@ApiTags("works")
@Controller("works")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class WorksController {
  constructor(private readonly service: WorksService) {}

  @Get()
  @ApiOkResponse({ description: "Current user works", schema: worksResponseJsonSchema })
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const requestId = createRequestId();
    const result = await this.service.list(this.userId(request), workListQuerySchema.parse(query));
    return workListResponseSchema.parse({
      data: result.works,
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  }

  @Post()
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiBody({ schema: createBodySchema })
  @ApiOkResponse({ description: "Created work", schema: workResponseJsonSchema })
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const requestId = createRequestId();
    const idempotencyKey =
      typeof request.headers["idempotency-key"] === "string"
        ? request.headers["idempotency-key"]
        : undefined;
    const auth = this.auth(request);
    const work = await this.service.create(
      auth.user.id,
      auth.user.displayName,
      workCreateRequestSchema.parse(body),
      this.auditContext(request, requestId),
      idempotencyKey,
    );
    return workResponseSchema.parse({
      data: work,
      requestId,
      meta: {},
    });
  }

  @Get(":workId")
  @ApiOkResponse({ description: "Work overview", schema: workResponseJsonSchema })
  async get(@Req() request: AuthenticatedRequest, @Param("workId") workId: string) {
    const requestId = createRequestId();
    return workResponseSchema.parse({
      data: await this.service.get(this.userId(request), uuidV7Schema.parse(workId)),
      requestId,
      meta: {},
    });
  }

  @Get(":workId/branches")
  @ApiOkResponse({ description: "Work branches", schema: branchesResponseJsonSchema })
  async branches(@Req() request: AuthenticatedRequest, @Param("workId") workId: string) {
    const requestId = createRequestId();
    return workBranchesResponseSchema.parse({
      data: await this.service.branches(this.userId(request), uuidV7Schema.parse(workId)),
      requestId,
      meta: {},
    });
  }

  private auth(request: AuthenticatedRequest) {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth;
  }

  private userId(request: AuthenticatedRequest): string {
    return this.auth(request).user.id;
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
