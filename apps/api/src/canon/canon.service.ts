import { Injectable } from "@nestjs/common";
import {
  canonCommitDecisionSchema,
  canonCommitFactSchema,
  canonCommitSchema,
  canonCommitSummarySchema,
  type CanonCommit,
  type CanonCommitRequest,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import type { WorksAuditContext } from "../works/works.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CanonRepository,
  type CanonCommitRecord,
  type ChapterRecord,
  type SubmittedFactRecord,
} from "./canon.repository";

@Injectable()
export class CanonService {
  constructor(private readonly repository: CanonRepository) {}

  async submit(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    input: CanonCommitRequest,
    idempotencyKey: string,
    audit: WorksAuditContext,
  ): Promise<CanonCommit> {
    const result = await this.repository.submit(
      userId,
      workId,
      branchId,
      chapterId,
      input.chapterVersionId,
      idempotencyKey,
      audit,
    );
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    if (result.kind === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "章节正文已更新，请重新审核后提交");
    }
    if (result.kind === "chapter_not_approved") {
      throw new ApiError(409, "CANON_CHAPTER_NOT_APPROVED", "请先批准本章，再提交事实", {
        chapterStatus: result.chapterStatus,
      });
    }
    if (result.kind === "blocked") {
      throw new ApiError(409, "FACT_SUBMISSION_BLOCKED", "本章仍有必填事实待确认", {
        pendingRequiredFactIds: result.pendingRequiredFactIds,
        unresolvedHighRiskFactIds: result.unresolvedHighRiskFactIds,
        proposalCount: result.proposalCount,
      });
    }
    return toCommit(result.chapter, result.commit, result.facts);
  }

  async list(userId: string, workId: string, branchId: string): Promise<CanonCommit[]> {
    const results = await this.repository.listCommits(userId, workId, branchId);
    if (results === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    return results.map((result) => toCommit(result.chapter, result.commit, result.facts));
  }
}

function toCommit(
  chapter: ChapterRecord,
  commit: CanonCommitRecord,
  facts: SubmittedFactRecord[],
): CanonCommit {
  return canonCommitSchema.parse({
    id: commit.id,
    workId: commit.workId,
    branchId: commit.branchId,
    chapterId: commit.chapterId,
    chapterVersionId: commit.chapterVersionId,
    versionNodeId: commit.versionNodeId,
    sourceChapter: {
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
    },
    decisions: commit.decisionSnapshot.map((decision) => canonCommitDecisionSchema.parse(decision)),
    facts: facts.map((fact) =>
      canonCommitFactSchema.parse({
        id: fact.id,
        proposalId: fact.factProposalId,
        decisionId: fact.decisionId,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        risk: fact.risk,
        required: fact.required,
        status: fact.proposalStatus,
      }),
    ),
    summary: canonCommitSummarySchema.parse(commit.summary),
    createdAt: commit.createdAt.toISOString(),
  });
}
