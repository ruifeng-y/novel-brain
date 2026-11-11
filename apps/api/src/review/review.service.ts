import { Injectable } from "@nestjs/common";
import type {
  ChapterReviewData,
  ChapterReviewDecision,
  ChapterReviewRequest,
} from "@novel-brain/contracts";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ChaptersService } from "../chapters/chapters.service";
import { ApiError } from "../common/api-error";
import type { WorksAuditContext } from "../works/works.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewRepository } from "./review.repository";
import type { ReviewDecisionRecord } from "./review.repository";

@Injectable()
export class ReviewService {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly chapters: ChaptersService,
  ) {}

  async review(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    input: ChapterReviewRequest,
    audit: WorksAuditContext,
  ): Promise<ChapterReviewData> {
    const result = await this.repository.review(userId, workId, branchId, chapterId, input, audit);
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    if (result.kind === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "章节已被其他操作更新，请刷新后重试");
    }
    if (result.kind === "invalid_state") {
      throw new ApiError(409, "VALIDATION_INVALID", "章节当前状态不能执行该审核动作", {
        status: result.status,
      });
    }
    if (result.kind === "quality_blocked") {
      const reportReady = result.gate.reportState === "fresh";
      throw new ApiError(
        409,
        "QUALITY_GATE_BLOCKED",
        reportReady
          ? "本章还有阻断级质量问题，请修订后再批准"
          : "请先检查本章，生成当前版本的质量报告后再批准",
        {
          gate: "chapter_approval",
          reportState: result.gate.reportState,
          blockers: result.gate.blockers,
        },
      );
    }
    return {
      chapter: await this.chapters.get(userId, workId, branchId, chapterId),
      decision: toDecision(result.decision),
    };
  }
}

function toDecision(record: ReviewDecisionRecord): ChapterReviewDecision {
  return {
    id: record.id,
    chapterId: record.chapterId,
    action: record.action as ChapterReviewDecision["action"],
    actorId: record.actorId,
    actorName: record.actorName,
    reason: record.reason,
    decidedAt: record.decidedAt.toISOString(),
  };
}
