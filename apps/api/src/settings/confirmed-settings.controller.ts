import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { confirmedSettingListResponseSchema, uuidV7Schema } from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from "./settings.service";

const confirmedSettingsResponseJsonSchema = z.toJSONSchema(confirmedSettingListResponseSchema, {
  target: "openapi-3.0",
  io: "output",
}) as SchemaObject;

@ApiTags("settings")
@Controller("works/:workId/branches/:branchId/facts")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ConfirmedSettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @ApiOkResponse({
    description: "Confirmed settings projection",
    schema: confirmedSettingsResponseJsonSchema,
  })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    return confirmedSettingListResponseSchema.parse({
      data: await this.service.confirmed(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
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
