import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  chunkedImportCreateRequestSchema,
  chunkedImportStartRequestSchema,
  chunkedImportChunkRequestSchema,
  chunkedImportProgressResponseSchema,
  manuscriptImportConfirmRequestSchema,
  manuscriptImportConfirmResponseSchema,
  manuscriptImportResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ManuscriptImportService, formatFromName } from "./manuscript-import.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const importResponseJsonSchema = schemaOf(manuscriptImportResponseSchema);
const confirmBodySchema = schemaOf(manuscriptImportConfirmRequestSchema);
const confirmResponseJsonSchema = schemaOf(manuscriptImportConfirmResponseSchema);
const chunkedCreateBodySchema = schemaOf(chunkedImportCreateRequestSchema);
const chunkedStartBodySchema = schemaOf(chunkedImportStartRequestSchema);
const chunkedChunkBodySchema = schemaOf(chunkedImportChunkRequestSchema);
const chunkedProgressResponseSchema = schemaOf(chunkedImportProgressResponseSchema);
const createRequestBodySchema: SchemaObject = {
  type: "object",
  required: ["file"],
  properties: {
    file: { type: "string", format: "binary" },
  },
};
const SUPPORTED_FILE_EXTENSIONS = [".txt", ".md", ".markdown"] as const;
const MAX_MANUSCRIPT_FILE_BYTES = 1024 * 1024;

interface UploadedTextFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@ApiTags("imports")
@Controller("imports/manuscripts")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ManuscriptImportController {
  constructor(private readonly service: ManuscriptImportService) {}

  @Post("chunked")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: chunkedCreateBodySchema })
  @ApiOkResponse({
    description: "Chunked manuscript import",
    schema: chunkedProgressResponseSchema,
  })
  async createChunked(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const requestId = createRequestId();
    return chunkedImportProgressResponseSchema.parse({
      data: await this.service.createChunked(
        this.userId(request),
        chunkedImportCreateRequestSchema.parse(body),
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : "",
      ),
      requestId,
      meta: {},
    });
  }

  @Post("chunked/start")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: chunkedStartBodySchema })
  @ApiOkResponse({
    description: "Started streamed manuscript import",
    schema: chunkedProgressResponseSchema,
  })
  async startChunked(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const requestId = createRequestId();
    return chunkedImportProgressResponseSchema.parse({
      data: await this.service.startChunked(
        this.userId(request),
        chunkedImportStartRequestSchema.parse(body),
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : "",
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":importId/chunks")
  @HttpCode(200)
  @ApiBody({ schema: chunkedChunkBodySchema })
  @ApiOkResponse({
    description: "Uploaded manuscript chunk",
    schema: chunkedProgressResponseSchema,
  })
  async appendChunk(
    @Req() request: AuthenticatedRequest,
    @Param("importId") importId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return chunkedImportProgressResponseSchema.parse({
      data: await this.service.appendChunk(
        this.userId(request),
        uuidV7Schema.parse(importId),
        chunkedImportChunkRequestSchema.parse(body),
      ),
      requestId,
      meta: {},
    });
  }

  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MANUSCRIPT_FILE_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: createRequestBodySchema })
  @ApiOkResponse({ description: "Parsed manuscript chapters", schema: importResponseJsonSchema })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() _body: unknown,
    @UploadedFile() file?: UploadedTextFile,
  ) {
    if (!file) {
      throw new ApiError(400, "VALIDATION_INVALID", "请选择 TXT 或 Markdown 旧稿文件");
    }
    const sourceName = file.originalname.trim();
    const extension = sourceName.slice(sourceName.lastIndexOf(".")).toLowerCase();
    if (
      !SUPPORTED_FILE_EXTENSIONS.includes(extension as (typeof SUPPORTED_FILE_EXTENSIONS)[number])
    ) {
      throw new ApiError(400, "VALIDATION_INVALID", "请选择 TXT 或 Markdown 旧稿文件");
    }
    if (file.size > MAX_MANUSCRIPT_FILE_BYTES) {
      throw new ApiError(400, "VALIDATION_INVALID", "旧稿文件不能超过 1 MB");
    }
    const text = decodeUtf8(file.buffer);
    const requestId = createRequestId();
    const result = await this.service.create(this.userId(request), {
      text,
      sourceName,
      format: formatFromName(sourceName),
    });
    return manuscriptImportResponseSchema.parse({
      data: result,
      requestId,
      meta: {},
    });
  }

  @Get(":importId")
  @ApiOkResponse({ description: "Parsed manuscript chapters", schema: importResponseJsonSchema })
  async get(@Req() request: AuthenticatedRequest, @Param("importId") importId: string) {
    const requestId = createRequestId();
    return manuscriptImportResponseSchema.parse({
      data: await this.service.get(this.userId(request), uuidV7Schema.parse(importId)),
      requestId,
      meta: {},
    });
  }

  @Post(":importId/process")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Processed next manuscript chunk",
    schema: chunkedProgressResponseSchema,
  })
  async processChunk(@Req() request: AuthenticatedRequest, @Param("importId") importId: string) {
    const requestId = createRequestId();
    return chunkedImportProgressResponseSchema.parse({
      data: await this.service.processChunk(this.userId(request), uuidV7Schema.parse(importId)),
      requestId,
      meta: {},
    });
  }

  @Get(":importId/progress")
  @ApiOkResponse({
    description: "Chunked manuscript progress",
    schema: chunkedProgressResponseSchema,
  })
  async progress(@Req() request: AuthenticatedRequest, @Param("importId") importId: string) {
    const requestId = createRequestId();
    return chunkedImportProgressResponseSchema.parse({
      data: await this.service.progress(this.userId(request), uuidV7Schema.parse(importId)),
      requestId,
      meta: {},
    });
  }

  @Post(":importId/pause")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Paused manuscript import",
    schema: chunkedProgressResponseSchema,
  })
  async pause(@Req() request: AuthenticatedRequest, @Param("importId") importId: string) {
    const requestId = createRequestId();
    return chunkedImportProgressResponseSchema.parse({
      data: await this.service.controlChunked(
        this.userId(request),
        uuidV7Schema.parse(importId),
        "pause",
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":importId/resume")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Resumed manuscript import",
    schema: chunkedProgressResponseSchema,
  })
  async resume(@Req() request: AuthenticatedRequest, @Param("importId") importId: string) {
    const requestId = createRequestId();
    return chunkedImportProgressResponseSchema.parse({
      data: await this.service.controlChunked(
        this.userId(request),
        uuidV7Schema.parse(importId),
        "resume",
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":importId/cancel")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Cancelled manuscript import",
    schema: chunkedProgressResponseSchema,
  })
  async cancel(@Req() request: AuthenticatedRequest, @Param("importId") importId: string) {
    const requestId = createRequestId();
    return chunkedImportProgressResponseSchema.parse({
      data: await this.service.controlChunked(
        this.userId(request),
        uuidV7Schema.parse(importId),
        "cancel",
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":importId/confirm")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiBody({ schema: confirmBodySchema })
  @ApiOkResponse({
    description: "Imported work and chapter versions",
    schema: confirmResponseJsonSchema,
  })
  async confirm(
    @Req() request: AuthenticatedRequest,
    @Param("importId") importId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const auth = this.auth(request);
    const result = await this.service.confirm(
      auth.user.id,
      auth.user.displayName,
      uuidV7Schema.parse(importId),
      manuscriptImportConfirmRequestSchema.parse(body),
      this.auditContext(request, requestId),
      `manuscript-import-${importId}`,
    );
    return manuscriptImportConfirmResponseSchema.parse({
      data: result,
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

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ApiError(400, "VALIDATION_INVALID", "旧稿编码无法解析，请使用 UTF-8 编码");
  }
}
