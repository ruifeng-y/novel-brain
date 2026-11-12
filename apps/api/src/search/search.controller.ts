import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  searchQuerySchema,
  searchRebuildResponseSchema,
  searchResponseSchema,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SearchService } from "./search.service";

@Controller("works/:workId/branches/:branchId/search")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  async search(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    const requestId = createRequestId();
    const data = await this.service.search(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      searchQuerySchema.parse(query),
    );
    return searchResponseSchema.parse({ data, requestId, meta: {} });
  }

  @Post("rebuild")
  @HttpCode(202)
  async rebuild(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
  ) {
    const requestId = createRequestId();
    const data = await this.service.startRebuild(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
    );
    return searchRebuildResponseSchema.parse({ data, requestId, meta: {} });
  }

  @Post("rebuilds/:runId/process")
  @HttpCode(200)
  async process(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("runId") runId: string,
  ) {
    const requestId = createRequestId();
    const data = await this.service.process(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      uuidV7Schema.parse(runId),
    );
    return searchRebuildResponseSchema.parse({ data, requestId, meta: {} });
  }

  @Get("rebuilds/:runId")
  async progress(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("runId") runId: string,
  ) {
    const requestId = createRequestId();
    const data = await this.service.rebuildProgress(
      this.userId(request),
      uuidV7Schema.parse(workId),
      uuidV7Schema.parse(branchId),
      uuidV7Schema.parse(runId),
    );
    return searchRebuildResponseSchema.parse({ data, requestId, meta: {} });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }
}

@Controller("search")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class GlobalSearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  async search(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const requestId = createRequestId();
    const data = await this.service.globalSearch(
      this.userId(request),
      searchQuerySchema.parse(query),
    );
    return searchResponseSchema.parse({ data, requestId, meta: {} });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }
}
