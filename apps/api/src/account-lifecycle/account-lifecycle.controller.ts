import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  accountDeletionCreateRequestSchema,
  accountDeletionRecoverResponseSchema,
  accountDeletionResponseSchema,
  accountExportDownloadResponseSchema,
  accountExportReceiptResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { AllowAccountDeletionPending } from "../auth/allow-account-deletion-pending.decorator";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AccountLifecycleService } from "./account-lifecycle.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const deletionCreateBodySchema = schemaOf(accountDeletionCreateRequestSchema);
const exportReceiptResponseJsonSchema = schemaOf(accountExportReceiptResponseSchema);
const exportDownloadResponseJsonSchema = schemaOf(accountExportDownloadResponseSchema);
const deletionResponseJsonSchema = schemaOf(accountDeletionResponseSchema);
const deletionRecoverResponseJsonSchema = schemaOf(accountDeletionRecoverResponseSchema);

@ApiTags("users")
@Controller("users/me")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class AccountLifecycleController {
  constructor(private readonly service: AccountLifecycleService) {}

  @Post("export")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Created account export receipt",
    schema: exportReceiptResponseJsonSchema,
  })
  async createExport(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const requestId = createRequestId();
    const receipt = await this.service.createExport(
      this.userId(request),
      this.auditContext(request, requestId),
      normalizeIdempotencyKey(idempotencyKey),
    );
    return accountExportReceiptResponseSchema.parse({
      data: receipt,
      requestId,
      meta: {},
    });
  }

  @Get("export/:receiptId/download")
  @ApiProduces("application/json")
  @ApiOkResponse({
    description: "Downloaded account export package",
    schema: exportDownloadResponseJsonSchema,
  })
  async downloadExport(
    @Req() request: AuthenticatedRequest,
    @Param("receiptId") receiptId: string,
    @Res() response: Response,
  ): Promise<void> {
    const requestId = createRequestId();
    const download = await this.service.downloadExport(
      this.userId(request),
      uuidV7Schema.parse(receiptId),
    );
    const packageBody = accountExportDownloadResponseSchema.parse({
      data: JSON.parse(download.payload) as unknown,
      requestId,
      meta: {},
    });
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("content-disposition", `attachment; filename="novel-brain-account.json"`);
    response.setHeader("x-export-checksum", download.checksum);
    response.setHeader("x-export-inventory-version", download.inventoryVersion);
    response.send(JSON.stringify(packageBody));
  }

  @Post("delete")
  @HttpCode(202)
  @AllowAccountDeletionPending()
  @ApiBody({ schema: deletionCreateBodySchema })
  @ApiAcceptedResponse({
    description: "Account deletion request accepted",
    schema: deletionResponseJsonSchema,
  })
  async requestDeletion(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    const requestId = createRequestId();
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    const deletion = await this.service.requestDeletion({
      userId: request.auth.user.id,
      sessionId: request.auth.session.id,
      request: accountDeletionCreateRequestSchema.parse(body),
      audit: this.auditContext(request, requestId),
      ...(normalizedIdempotencyKey ? { idempotencyKey: normalizedIdempotencyKey } : {}),
    });
    return accountDeletionResponseSchema.parse({
      data: deletion,
      requestId,
      meta: {},
    });
  }

  @Get("deletion")
  @AllowAccountDeletionPending()
  @ApiOkResponse({
    description: "Current account deletion request",
    schema: deletionResponseJsonSchema,
  })
  async getDeletion(@Req() request: AuthenticatedRequest) {
    const requestId = createRequestId();
    const deletion = await this.service.getDeletion(this.userId(request));
    return accountDeletionResponseSchema.parse({
      data: deletion,
      requestId,
      meta: {},
    });
  }

  @Post("deletion/recover")
  @HttpCode(200)
  @AllowAccountDeletionPending()
  @ApiOkResponse({
    description: "Recovered account deletion request",
    schema: deletionRecoverResponseJsonSchema,
  })
  async recoverDeletion(@Req() request: AuthenticatedRequest) {
    const requestId = createRequestId();
    const deletion = await this.service.recoverDeletion(
      this.userId(request),
      this.auditContext(request, requestId),
    );
    return accountDeletionRecoverResponseSchema.parse({
      data: deletion,
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

  private auditContext(request: AuthenticatedRequest, requestId: string) {
    const userAgent = String(request.headers["user-agent"] ?? "").trim();
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: userAgent || "unknown",
    };
  }
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}
