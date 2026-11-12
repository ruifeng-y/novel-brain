import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags, type SchemaObject } from "@nestjs/swagger";
import { genrePackListQuerySchema, genrePackListResponseSchema } from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
import { ApiQuerySchema } from "../common/zod-openapi";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksService } from "./works.service";

function schemaOf(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

const listJsonSchema = schemaOf(genrePackListResponseSchema);

@ApiTags("works")
@Controller("genre-packs")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class GenrePackController {
  constructor(private readonly service: WorksService) {}

  @Get()
  @ApiQuerySchema(genrePackListQuerySchema)
  @ApiOkResponse({ description: "Available genre packs", schema: listJsonSchema })
  async list(@Req() request: AuthenticatedRequest) {
    const requestId = createRequestId();
    const query = genrePackListQuerySchema.parse(request.query ?? {});
    return genrePackListResponseSchema.parse({
      data: await this.service.listGenrePacks(query),
      requestId,
      meta: {},
    });
  }
}
