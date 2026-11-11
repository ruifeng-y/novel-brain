import { Injectable } from "@nestjs/common";
import type { RetrievalQuery, RetrievalResult } from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RetrievalRepository } from "./retrieval.repository";

@Injectable()
export class RetrievalService {
  constructor(private readonly repository: RetrievalRepository) {}

  async search(
    userId: string,
    workId: string,
    branchId: string,
    input: RetrievalQuery,
  ): Promise<{ results: RetrievalResult[]; tookMs: number }> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，或无权访问");
    }
    return this.repository.search(userId, workId, branchId, input);
  }
}
