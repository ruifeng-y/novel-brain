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
  importReportResponseSchema,
  settingsImportCreateRequestSchema,
  settingsImportConfirmRequestSchema,
  settingsImportConflictDecisionRequestSchema,
  settingsImportResponseSchema,
  uuidV7Schema,
  workResponseSchema,
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
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { getClientIp } from "../auth/client-ip";
import { MAX_IMPORT_UPLOAD_BYTES, type ImportUploadFile } from "./import-file";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsImportService } from "./settings-import.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const createBodySchema = schemaOf(settingsImportCreateRequestSchema);
const createRequestBodySchema: SchemaObject = {
  oneOf: [
    createBodySchema,
    {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
        sourceName: { type: "string", maxLength: 200 },
      },
    },
  ],
};
const confirmBodySchema = schemaOf(settingsImportConfirmRequestSchema);
const decisionBodySchema = schemaOf(settingsImportConflictDecisionRequestSchema);
const importResponseJsonSchema = schemaOf(settingsImportResponseSchema);
const reportResponseJsonSchema = schemaOf(importReportResponseSchema);
const workResponseJsonSchema = schemaOf(workResponseSchema);

@ApiTags("imports")
@Controller("imports")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class SettingsImportController {
  constructor(private readonly service: SettingsImportService) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_UPLOAD_BYTES.settings } }),
  )
  @ApiConsumes("application/json", "multipart/form-data")
  @ApiBody({ schema: createRequestBodySchema })
  @ApiOkResponse({
    description: "Recognized settings candidates",
    schema: importResponseJsonSchema,
  })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @UploadedFile() file?: ImportUploadFile,
  ) {
    const requestId = createRequestId();
    const result = file
      ? await this.service.createFromFile(this.userId(request), file, sourceNameOverride(body))
      : await this.service.create(
          this.userId(request),
          settingsImportCreateRequestSchema.parse(body),
          { kind: "paste", name: null },
        );
    return settingsImportResponseSchema.parse({
      data: result,
      requestId,
      meta: {},
    });
  }

  @Get(":importId")
  @ApiOkResponse({ description: "Settings import report", schema: importResponseJsonSchema })
  async get(@Req() request: AuthenticatedRequest, @Param("importId") importId: string) {
    const requestId = createRequestId();
    return settingsImportResponseSchema.parse({
      data: await this.service.get(this.userId(request), uuidV7Schema.parse(importId)),
      requestId,
      meta: {},
    });
  }

  @Get(":importId/report")
  @ApiOkResponse({ description: "Settings import report", schema: reportResponseJsonSchema })
  async getReport(@Req() request: AuthenticatedRequest, @Param("importId") importId: string) {
    const requestId = createRequestId();
    const settingsImport = await this.service.get(
      this.userId(request),
      uuidV7Schema.parse(importId),
    );
    return importReportResponseSchema.parse({
      data: settingsImport.report,
      requestId,
      meta: {},
    });
  }

  @Post(":importId/conflicts/:conflictId/decision")
  @HttpCode(200)
  @ApiBody({ schema: decisionBodySchema })
  @ApiOkResponse({ description: "Updated settings import", schema: importResponseJsonSchema })
  async decideConflict(
    @Req() request: AuthenticatedRequest,
    @Param("importId") importId: string,
    @Param("conflictId") conflictId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return settingsImportResponseSchema.parse({
      data: await this.service.decideConflict(
        this.userId(request),
        uuidV7Schema.parse(importId),
        uuidV7Schema.parse(conflictId),
        settingsImportConflictDecisionRequestSchema.parse(body),
      ),
      requestId,
      meta: {},
    });
  }

  @Post(":importId/confirm")
  @HttpCode(200)
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiBody({ schema: confirmBodySchema })
  @ApiOkResponse({ description: "Created work", schema: workResponseJsonSchema })
  async confirm(
    @Req() request: AuthenticatedRequest,
    @Param("importId") importId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const auth = this.auth(request);
    const idempotencyKey = `settings-import-${importId}`;
    const work = await this.service.confirm(
      auth.user.id,
      auth.user.displayName,
      uuidV7Schema.parse(importId),
      settingsImportConfirmRequestSchema.parse(body),
      this.auditContext(request, requestId),
      idempotencyKey,
    );
    return workResponseSchema.parse({
      data: work,
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

function sourceNameOverride(body: unknown): string | undefined {
  const form = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return typeof form.sourceName === "string" && form.sourceName.trim()
    ? form.sourceName.trim()
    : undefined;
}
