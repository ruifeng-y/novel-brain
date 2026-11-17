import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  genrePackVersionChangeRequestSchema,
  uuidV7Schema,
  workBranchListQuerySchema,
  workBranchesResponseSchema,
  workCreateRequestSchema,
  workDuplicateRequestSchema,
  workLifecycleRequestSchema,
  workListQuerySchema,
  workListResponseSchema,
  workOverviewQuerySchema,
  workPurgeResponseSchema,
  workResponseSchema,
  workTrashResponseSchema,
  workUpdateRequestSchema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { ApiQuerySchema } from "../common/zod-openapi";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksService } from "./works.service";
import type { WorkCoverUpload } from "./works.service";

const MAX_WORK_COVER_BYTES = 5 * 1024 * 1024;

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const createBodySchema = schemaOf(workCreateRequestSchema);
const workResponseJsonSchema = schemaOf(workResponseSchema);
const worksResponseJsonSchema = schemaOf(workListResponseSchema);
const branchesResponseJsonSchema = schemaOf(workBranchesResponseSchema);
const genrePackVersionBodyJsonSchema = schemaOf(genrePackVersionChangeRequestSchema);
const updateBodySchema = schemaOf(workUpdateRequestSchema);
const lifecycleBodySchema = schemaOf(workLifecycleRequestSchema);
const duplicateBodySchema = schemaOf(workDuplicateRequestSchema);
const trashResponseJsonSchema = schemaOf(workTrashResponseSchema);
const purgeResponseJsonSchema = schemaOf(workPurgeResponseSchema);

@ApiTags("works")
@Controller("works")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class WorksController {
  constructor(private readonly service: WorksService) {}

  @Get()
  @ApiQuerySchema(workListQuerySchema)
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
  @ApiQuerySchema(workOverviewQuerySchema)
  @ApiOkResponse({ description: "Work overview", schema: workResponseJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const parsedQuery = workOverviewQuerySchema.parse(query ?? {});
    return workResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        uuidV7Schema.parse(workId),
        parsedQuery.branchId,
      ),
      requestId,
      meta: {},
    });
  }

  @Get(":workId/cover")
  @ApiProduces("image/webp")
  @ApiOkResponse({ description: "Work cover image" })
  async cover(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Res() response: Response,
  ) {
    const cover = await this.service.cover(this.userId(request), uuidV7Schema.parse(workId));
    response.setHeader("content-type", cover.contentType);
    response.setHeader("cache-control", "private, max-age=300");
    response.send(Buffer.from(cover.bytes));
  }

  @Put(":workId/cover")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_WORK_COVER_BYTES },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
      required: ["file"],
    },
  })
  @ApiOkResponse({ description: "Work with uploaded cover", schema: workResponseJsonSchema })
  async uploadCover(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Query() query: unknown,
    @UploadedFile() file?: WorkCoverUpload,
  ) {
    const requestId = createRequestId();
    const parsedQuery = workLifecycleRequestSchema.parse({
      version: Number((query as { version?: string }).version),
    });
    const data = await this.service.uploadCover(
      this.userId(request),
      uuidV7Schema.parse(workId),
      parsedQuery,
      file,
      this.auditContext(request, requestId),
    );
    return workResponseSchema.parse({ data, requestId, meta: {} });
  }

  @Post(":workId/genre-pack/version")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: genrePackVersionBodyJsonSchema })
  @ApiOkResponse({
    description: "Work with changed genre pack version",
    schema: workResponseJsonSchema,
  })
  async changeGenrePackVersion(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const idempotencyKey =
      typeof request.headers["idempotency-key"] === "string"
        ? request.headers["idempotency-key"]
        : "";
    const data = await this.service.changeGenrePackVersion(
      this.userId(request),
      uuidV7Schema.parse(workId),
      genrePackVersionChangeRequestSchema.parse(body),
      this.auditContext(request, requestId),
      idempotencyKey,
    );
    return workResponseSchema.parse({ data, requestId, meta: {} });
  }

  @Get(":workId/branches")
  @ApiQuerySchema(workBranchListQuerySchema)
  @ApiOkResponse({ description: "Work branches", schema: branchesResponseJsonSchema })
  async branches(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const page = await this.service.branches(
      this.userId(request),
      uuidV7Schema.parse(workId),
      workBranchListQuerySchema.parse(query ?? {}),
    );
    return workBranchesResponseSchema.parse({
      data: page.data,
      requestId,
      meta: { nextCursor: page.nextCursor },
    });
  }

  @Patch(":workId")
  @ApiBody({ schema: updateBodySchema })
  @ApiOkResponse({ description: "Updated work", schema: workResponseJsonSchema })
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const work = await this.service.update(
      this.userId(request),
      uuidV7Schema.parse(workId),
      workUpdateRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return workResponseSchema.parse({ data: work, requestId, meta: {} });
  }

  @Post(":workId/archive")
  @HttpCode(200)
  @ApiBody({ schema: lifecycleBodySchema })
  @ApiOkResponse({ description: "Archived work", schema: workResponseJsonSchema })
  async archive(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const work = await this.service.archive(
      this.userId(request),
      uuidV7Schema.parse(workId),
      workLifecycleRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return workResponseSchema.parse({ data: work, requestId, meta: {} });
  }

  @Post(":workId/restore")
  @HttpCode(200)
  @ApiBody({ schema: lifecycleBodySchema })
  @ApiOkResponse({ description: "Restored work", schema: workResponseJsonSchema })
  async restore(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const work = await this.service.restore(
      this.userId(request),
      uuidV7Schema.parse(workId),
      workLifecycleRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return workResponseSchema.parse({ data: work, requestId, meta: {} });
  }

  @Post(":workId/duplicate")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: duplicateBodySchema })
  @ApiOkResponse({ description: "Duplicated work", schema: workResponseJsonSchema })
  async duplicate(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    const requestId = createRequestId();
    const work = await this.service.duplicate(
      this.userId(request),
      uuidV7Schema.parse(workId),
      workDuplicateRequestSchema.parse(body ?? {}),
      this.auditContext(request, requestId),
      idempotencyKey,
    );
    return workResponseSchema.parse({ data: work, requestId, meta: {} });
  }

  @Post(":workId/trash")
  @HttpCode(200)
  @ApiBody({ schema: lifecycleBodySchema })
  @ApiOkResponse({ description: "Trashed work", schema: trashResponseJsonSchema })
  async trash(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const data = await this.service.trash(
      this.userId(request),
      uuidV7Schema.parse(workId),
      workLifecycleRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return workTrashResponseSchema.parse({ data, requestId, meta: {} });
  }

  @Post(":workId/trash/restore")
  @HttpCode(200)
  @ApiBody({ schema: lifecycleBodySchema })
  @ApiOkResponse({ description: "Restored work", schema: workResponseJsonSchema })
  async restoreTrash(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const data = await this.service.restoreTrash(
      this.userId(request),
      uuidV7Schema.parse(workId),
      workLifecycleRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return workResponseSchema.parse({ data, requestId, meta: {} });
  }

  @Post(":workId/purge")
  @HttpCode(200)
  @ApiBody({ schema: lifecycleBodySchema })
  @ApiOkResponse({ description: "Permanently deleted work", schema: purgeResponseJsonSchema })
  async purge(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const data = await this.service.purge(
      this.userId(request),
      uuidV7Schema.parse(workId),
      workLifecycleRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return workPurgeResponseSchema.parse({ data, requestId, meta: {} });
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
