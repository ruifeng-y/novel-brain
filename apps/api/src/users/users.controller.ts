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
  authorPenNameCreateRequestSchema,
  authorPenNameDeleteResponseSchema,
  authorPenNameListResponseSchema,
  authorPenNameResponseSchema,
  authorPenNameUpdateRequestSchema,
  profileResponseSchema,
  profileUpdateRequestSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { ApiBody, ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

import { getClientIp } from "../auth/client-ip";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from "./users.service";

function envelope<T>(data: T, requestId = createRequestId()) {
  return { data, requestId, meta: {} };
}

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const updateBodySchema = schemaOf(profileUpdateRequestSchema);
const profileResponseJsonSchema = schemaOf(profileResponseSchema);
const penNameCreateBodySchema = schemaOf(authorPenNameCreateRequestSchema);
const penNameUpdateBodySchema = schemaOf(authorPenNameUpdateRequestSchema);
const penNameResponseJsonSchema = schemaOf(authorPenNameResponseSchema);
const penNameListResponseJsonSchema = schemaOf(authorPenNameListResponseSchema);
const penNameDeleteResponseJsonSchema = schemaOf(authorPenNameDeleteResponseSchema);

@ApiTags("users")
@Controller("users")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Patch("me")
  @ApiBody({ schema: updateBodySchema })
  @ApiOkResponse({ description: "Updated display profile", schema: profileResponseJsonSchema })
  async updateProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    const requestId = createRequestId();
    const profile = await this.service.updateProfile(
      request.auth.user.id,
      profileUpdateRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return profileResponseSchema.parse(envelope(profile, requestId));
  }

  @Get("me/pen-names")
  @ApiOkResponse({ description: "Author pen names", schema: penNameListResponseJsonSchema })
  async listPenNames(@Req() request: AuthenticatedRequest) {
    return authorPenNameListResponseSchema.parse(
      envelope(await this.service.listPenNames(this.userId(request))),
    );
  }

  @Post("me/pen-names")
  @HttpCode(200)
  @ApiBody({ schema: penNameCreateBodySchema })
  @ApiOkResponse({ description: "Created pen name", schema: penNameResponseJsonSchema })
  async createPenName(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const requestId = createRequestId();
    const penName = await this.service.createPenName(
      this.userId(request),
      authorPenNameCreateRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return authorPenNameResponseSchema.parse(envelope(penName, requestId));
  }

  @Patch("me/pen-names/:penNameId")
  @ApiBody({ schema: penNameUpdateBodySchema })
  @ApiOkResponse({ description: "Updated pen name", schema: penNameResponseJsonSchema })
  async updatePenName(
    @Req() request: AuthenticatedRequest,
    @Param("penNameId") penNameId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const penName = await this.service.updatePenName(
      this.userId(request),
      uuidV7Schema.parse(penNameId),
      authorPenNameUpdateRequestSchema.parse(body),
      this.auditContext(request, requestId),
    );
    return authorPenNameResponseSchema.parse(envelope(penName, requestId));
  }

  @Delete("me/pen-names/:penNameId")
  @HttpCode(200)
  @ApiOkResponse({ description: "Deleted pen name", schema: penNameDeleteResponseJsonSchema })
  async deletePenName(@Req() request: AuthenticatedRequest, @Param("penNameId") penNameId: string) {
    const requestId = createRequestId();
    await this.service.deletePenName(
      this.userId(request),
      uuidV7Schema.parse(penNameId),
      this.auditContext(request, requestId),
    );
    return authorPenNameDeleteResponseSchema.parse(envelope({ deleted: true }, requestId));
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
