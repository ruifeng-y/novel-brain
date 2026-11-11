import { Injectable } from "@nestjs/common";
import {
  factProposalSchema,
  type FactProposal,
  type FactProposalDecisionRequest,
  type FactProposalListQuery,
  type FactProposalStatus,
  type FactRisk,
} from "@novel-brain/contracts";
import { extractFactCandidates } from "@novel-brain/core";

import { ApiError } from "../common/api-error";
import { invalidCursorError, type CursorPageResult } from "../common/cursor-page";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FactsRepository, type FactProposalWithDecision } from "./facts.repository";

@Injectable()
export class FactsService {
  constructor(private readonly repository: FactsRepository) {}

  async extract(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<FactProposal[]> {
    const context = await this.requireContext(userId, workId, branchId, chapterId);
    if (!context.version) {
      throw new ApiError(400, "VALIDATION_INVALID", "当前章节还没有可抽取事实的正文版本");
    }
    const candidates = extractFactCandidates(context.version.content);
    if (candidates.length === 0) {
      throw new ApiError(400, "VALIDATION_INVALID", "当前正文没有可抽取的事实句子");
    }
    return (await this.repository.extract(userId, context, candidates)).map((record) =>
      this.toContract(record),
    );
  }

  async list(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    query: FactProposalListQuery,
  ): Promise<CursorPageResult<FactProposal>> {
    await this.requireContext(userId, workId, branchId, chapterId);
    const page = await this.repository.list(userId, workId, branchId, chapterId, query);
    if (page === "invalid_cursor") {
      throw invalidCursorError();
    }
    return {
      data: page.data.map((record) => this.toContract(record)),
      nextCursor: page.nextCursor,
    };
  }

  async decide(
    userId: string,
    workId: string,
    branchId: string,
    factProposalId: string,
    input: FactProposalDecisionRequest,
  ): Promise<FactProposal> {
    const result = await this.repository.decide(userId, workId, branchId, factProposalId, input);
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "事实提案不存在或无权访问");
    }
    if (result.kind === "not_pending") {
      throw new ApiError(409, "VERSION_CONFLICT", "事实提案已完成决策，请刷新后查看");
    }
    return this.toContract(result.value);
  }

  private async requireContext(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ) {
    const context = await this.repository.findChapterContext(userId, workId, branchId, chapterId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    return context;
  }

  private toContract(record: FactProposalWithDecision): FactProposal {
    return factProposalSchema.parse({
      id: record.proposal.id,
      workId: record.proposal.workId,
      branchId: record.proposal.branchId,
      chapterId: record.proposal.chapterId,
      sourceVersionId: record.proposal.sourceVersionId,
      subject: record.proposal.subject,
      predicate: record.proposal.predicate,
      object: record.proposal.object,
      sourceSentence: record.proposal.sourceSentence,
      status: record.proposal.status as FactProposalStatus,
      confidence: record.proposal.confidence,
      risk: record.proposal.risk as FactRisk,
      required: record.proposal.required,
      decision: record.decision
        ? {
            id: record.decision.id,
            action: record.decision.action as "confirm" | "modify_confirm" | "reject" | "supersede",
            actorId: record.decision.actorId,
            actorName: record.decision.actorName,
            reason: record.decision.reason,
            decidedAt: record.decision.decidedAt.toISOString(),
          }
        : null,
      createdAt: record.proposal.createdAt.toISOString(),
      updatedAt: record.proposal.updatedAt.toISOString(),
    });
  }
}
