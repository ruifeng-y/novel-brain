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
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  uuidV7Schema,
  workExportListQuerySchema,
  workExportReceiptListResponseSchema,
  workExportReceiptResponseSchema,
  workExportRequestSchema,
} from "@novel-brain/contracts";
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import { createRequestId } from "@novel-brain/core";
import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkExportService } from "./work-export.service";

function schemaOf(schema: z.ZodType, io: "input" | "output" = "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const requestJsonSchema = schemaOf(workExportRequestSchema, "input");
const receiptJsonSchema = schemaOf(workExportReceiptResponseSchema);
const receiptListJsonSchema = schemaOf(workExportReceiptListResponseSchema);

@ApiTags("work-exports")
@Controller("works/:workId/branches/:branchId/exports")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class WorkExportController {
  constructor(private readonly service: WorkExportService) {}

  @Post()
  @HttpCode(202)
  @ApiBody({ schema: requestJsonSchema })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for replaying the same export request",
  })
  @ApiAcceptedResponse({ description: "Queued work export", schema: receiptJsonSchema })
  async start(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return workExportReceiptResponseSchema.parse({
      data: await this.service.start(
        this.userId(request),
        this.context(workId, branchId),
        idempotencyKey ?? "",
        workExportRequestSchema.parse(body ?? {}),
        this.audit(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get()
  @ApiQuerySchema(workExportListQuerySchema)
  @ApiOkResponse({ description: "Work export history", schema: receiptListJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const page = workExportListQuerySchema.parse(query ?? {});
    const result = await this.service.list(
      this.userId(request),
      this.context(workId, branchId),
      page,
    );
    return workExportReceiptListResponseSchema.parse({
      data: result.receipts,
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  }

  @Get(":exportId")
  @ApiOkResponse({ description: "Work export receipt", schema: receiptJsonSchema })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("exportId") exportId: string,
  ) {
    const requestId = createRequestId();
    return workExportReceiptResponseSchema.parse({
      data: await this.service.get(
        this.userId(request),
        this.context(workId, branchId),
        uuidV7Schema.parse(exportId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get(":exportId/download")
  async download(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("exportId") exportId: string,
    @Res() response: Response,
  ) {
    const download = await this.service.download(
      this.userId(request),
      this.context(workId, branchId),
      uuidV7Schema.parse(exportId),
    );
    response.setHeader("content-type", download.contentType);
    response.setHeader(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
    );
    response.setHeader("x-export-checksum", download.checksum);
    response.send(download.bytes);
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

  private audit(request: AuthenticatedRequest, requestId: string) {
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: String(request.headers["user-agent"] ?? "").trim() || "unknown",
    };
  }
}
