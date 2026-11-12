import {
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
import { ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import {
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationReadAllResponseSchema,
  notificationReadResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NotificationService } from "./notification.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const listJsonSchema = schemaOf(notificationListResponseSchema);
const readJsonSchema = schemaOf(notificationReadResponseSchema);
const readAllJsonSchema = schemaOf(notificationReadAllResponseSchema);

@ApiTags("notifications")
@Controller("notifications")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  @ApiQuerySchema(notificationListQuerySchema)
  @ApiOkResponse({ description: "Tenant-scoped notification list", schema: listJsonSchema })
  async list(
    @Req() request: AuthenticatedRequest,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const requestId = createRequestId();
    const query = notificationListQuerySchema.parse({ unreadOnly, cursor, limit });
    const page = await this.service.list(this.userId(request), query);
    return notificationListResponseSchema.parse({
      data: page.items,
      requestId,
      meta: { nextCursor: page.nextCursor, unreadCount: page.unreadCount },
    });
  }

  @Patch(":notificationId/read")
  @HttpCode(200)
  @ApiOkResponse({ description: "Read notification", schema: readJsonSchema })
  async markRead(
    @Req() request: AuthenticatedRequest,
    @Param("notificationId") notificationId: string,
  ) {
    const requestId = createRequestId();
    return notificationReadResponseSchema.parse({
      data: await this.service.markRead(this.userId(request), uuidV7Schema.parse(notificationId)),
      requestId,
      meta: {},
    });
  }

  @Post("read-all")
  @HttpCode(200)
  @ApiOkResponse({ description: "Marked all notifications read", schema: readAllJsonSchema })
  async markAllRead(@Req() request: AuthenticatedRequest) {
    const requestId = createRequestId();
    return notificationReadAllResponseSchema.parse({
      data: { updated: await this.service.markAllRead(this.userId(request)) },
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
