import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  customFieldDefinitionCreateRequestSchema,
  customFieldDefinitionListQuerySchema,
  customFieldDefinitionListResponseSchema,
  customFieldDefinitionPatchRequestSchema,
  customFieldDefinitionResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import {
  ApiBody,
  ApiCreatedResponse,
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
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from "./settings.service";

function schemaOf(schema: z.ZodType, io: "input" | "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const createBodyJsonSchema = schemaOf(customFieldDefinitionCreateRequestSchema, "input");
const patchBodyJsonSchema = schemaOf(customFieldDefinitionPatchRequestSchema, "input");
const listResponseJsonSchema = schemaOf(customFieldDefinitionListResponseSchema, "output");
const definitionResponseJsonSchema = schemaOf(customFieldDefinitionResponseSchema, "output");

@ApiTags("settings")
@Controller("works/:workId/branches/:branchId/custom-fields")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class CustomFieldsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ description: "Custom field definitions", schema: listResponseJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const result = await this.service.listCustomFields(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      customFieldDefinitionListQuerySchema.parse(query ?? {}),
    );
    return customFieldDefinitionListResponseSchema.parse({
      data: result.data,
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  }

  @Post()
  @HttpCode(201)
  @ApiBody({ schema: createBodyJsonSchema })
  @ApiCreatedResponse({
    description: "Created custom field definition",
    schema: definitionResponseJsonSchema,
  })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return customFieldDefinitionResponseSchema.parse({
      data: await this.service.createCustomField(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        customFieldDefinitionCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Patch(":fieldId")
  @ApiBody({ schema: patchBodyJsonSchema })
  @ApiOkResponse({
    description: "Updated custom field definition",
    schema: definitionResponseJsonSchema,
  })
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("fieldId") fieldId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return customFieldDefinitionResponseSchema.parse({
      data: await this.service.updateCustomField(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(fieldId),
        customFieldDefinitionPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
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

  private auditContext(request: AuthenticatedRequest, requestId: string) {
    const userAgent = String(request.headers["user-agent"] ?? "").trim();
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: userAgent || "unknown",
    };
  }
}
