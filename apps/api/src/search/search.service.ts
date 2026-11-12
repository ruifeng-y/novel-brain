import { Injectable } from "@nestjs/common";
import type { SearchQuery } from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SearchRepository } from "./search.repository";

@Injectable()
export class SearchService {
  constructor(private readonly repository: SearchRepository) {}

  async rebuild(userId: string, workId: string, branchId: string) {
    const result = await this.repository.rebuild(userId, workId, branchId);
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，或无权访问");
    }
    return result;
  }

  async startRebuild(userId: string, workId: string, branchId: string) {
    const result = await this.repository.startRebuild(userId, workId, branchId);
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，或无权访问");
    }
    return result;
  }

  async process(userId: string, workId: string, branchId: string, runId: string) {
    const result = await this.repository.processRebuildRun(userId, workId, branchId, runId);
    if (result === "not_found") {
      throw new ApiError(404, "VERSION_NODE_NOT_FOUND", "索引重建任务不存在或无权访问");
    }
    return result;
  }

  async rebuildProgress(userId: string, workId: string, branchId: string, runId: string) {
    const result = await this.repository.rebuildProgress(userId, workId, branchId, runId);
    if (result === "not_found") {
      throw new ApiError(404, "VERSION_NODE_NOT_FOUND", "索引重建任务不存在或无权访问");
    }
    return result;
  }

  async search(userId: string, workId: string, branchId: string, input: SearchQuery) {
    const result = await this.repository.search(userId, workId, branchId, input);
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，或无权访问");
    }
    return result;
  }

  async globalSearch(userId: string, input: SearchQuery) {
    return this.repository.globalSearch(userId, input);
  }
}
