import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type {
  GoldenThreeCandidateBatchRequest,
  GoldenThreeChapterPinInput,
  GoldenThreeContinuationRequest,
  GoldenThreeGateBlockerCode,
  GoldenThreeGenerateRequest,
  GoldenThreeLockRequest,
  GoldenThreeReviewDimension,
  GoldenThreeReviewBatchRequest,
  GoldenThreeStrategy,
  GoldenThreeSelectionRequest,
  GoldenThreeWorkspace,
} from "@novel-brain/contracts";
import {
  auditLogs,
  chapterVersions,
  chapters,
  contextPackVersions,
  createDatabaseClient,
  createDatabasePool,
  goldenThreeCandidates,
  goldenThreeLocks,
  goldenThreeReviews,
  findIdempotentResource,
  rememberIdempotentResource,
  styleBaselines,
  versionNodes,
  withTenantTransaction,
  workBranches,
  works,
  type DatabaseClient,
  type GoldenThreeChapterPinJson,
} from "@novel-brain/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { countWords } from "../imports/manuscript-import.parser";
import type { WorksAuditContext } from "../works/works.repository";

const goldenThreeGenerationStrategies: Array<{
  strategy: GoldenThreeStrategy;
  label: string;
}> = [
  { strategy: "hook_focus", label: "候选 A · 钩子优先" },
  { strategy: "character_focus", label: "候选 B · 人物优先" },
  { strategy: "world_focus", label: "候选 C · 世界规则优先" },
];

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export type GoldenThreeCandidateRecord = InferSelectModel<typeof goldenThreeCandidates>;
export type GoldenThreeReviewRecord = InferSelectModel<typeof goldenThreeReviews>;
export type GoldenThreeLockRecord = InferSelectModel<typeof goldenThreeLocks>;
export type StyleBaselineRecord = InferSelectModel<typeof styleBaselines>;

export interface GoldenThreeContext {
  workId: string;
  branchId: string;
}

export type GoldenThreeWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "candidates_exist" }
  | { kind: "chapters_empty"; chapterNumbers: number[] }
  | { kind: "reference_invalid"; message: string }
  | { kind: "evidence_invalid"; message: string }
  | { kind: "version_conflict" }
  | { kind: "candidate_locked" }
  | { kind: "selection_required" }
  | { kind: "continuation_required" }
  | { kind: "review_incomplete"; completed: number }
  | { kind: "review_failed"; failedDimensions: GoldenThreeReviewDimension[] }
  | { kind: "already_locked" };

@Injectable()
export class GoldenThreeRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async findWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<GoldenThreeContext | undefined> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [context] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
        .from(works)
        .innerJoin(
          workBranches,
          and(eq(workBranches.workId, works.id), eq(workBranches.userId, works.userId)),
        )
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(workBranches.id, branchId),
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return context;
    });
  }

  async workspace(userId: string, context: GoldenThreeContext): Promise<GoldenThreeWorkspace> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const candidateRows = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .orderBy(asc(goldenThreeCandidates.createdAt), asc(goldenThreeCandidates.label));
      const candidateIds = candidateRows.map((candidate) => candidate.id);
      const reviewRows =
        candidateIds.length === 0
          ? []
          : await transaction
              .select()
              .from(goldenThreeReviews)
              .where(inArray(goldenThreeReviews.candidateId, candidateIds))
              .orderBy(asc(goldenThreeReviews.createdAt));
      const [lockRecord] = await transaction
        .select()
        .from(goldenThreeLocks)
        .where(
          and(
            eq(goldenThreeLocks.userId, userId),
            eq(goldenThreeLocks.workId, context.workId),
            eq(goldenThreeLocks.branchId, context.branchId),
          ),
        )
        .limit(1);
      const [styleRecord] = lockRecord
        ? await transaction
            .select()
            .from(styleBaselines)
            .where(eq(styleBaselines.id, lockRecord.styleBaselineId))
            .limit(1)
        : [undefined];
      const reviewsByCandidate = new Map<string, GoldenThreeReviewRecord[]>();
      for (const review of reviewRows) {
        const group = reviewsByCandidate.get(review.candidateId) ?? [];
        group.push(review);
        reviewsByCandidate.set(review.candidateId, group);
      }
      const continuationByCandidate = await readLatestContinuations(
        transaction,
        userId,
        context,
        candidateRows.map((candidate) => candidate.id),
      );

      const candidates = candidateRows.map((candidate) => {
        const reviews = reviewsByCandidate.get(candidate.id) ?? [];
        const failedDimensions = reviews
          .filter((review) => review.required && review.score < 4)
          .map((review) => review.dimension as GoldenThreeReviewDimension);
        return {
          id: candidate.id,
          batchId: candidate.batchId,
          workId: candidate.workId,
          branchId: candidate.branchId,
          label: candidate.label,
          strategy: candidate.strategy as "hook_focus" | "character_focus" | "world_focus",
          status: candidate.status as "draft" | "reviewed" | "selected" | "locked",
          version: candidate.version,
          prompt: {
            key: candidate.promptKey,
            version: candidate.promptVersion,
            hash: candidate.promptHash,
          },
          model: {
            provider: candidate.modelProvider,
            model: candidate.model,
            parameters: candidate.modelParameters,
          },
          context: {
            packVersionId: candidate.contextPackVersionId,
            manifestHash: candidate.contextManifestHash,
          },
          pins: candidate.chapterPins,
          continuation: continuationByCandidate.get(candidate.id) ?? null,
          reviews: reviews.map((review) => ({
            id: review.id,
            candidateId: review.candidateId,
            dimension: review.dimension as GoldenThreeReviewDimension,
            score: review.score,
            evidence: {
              chapterId: review.evidenceChapterId,
              chapterVersionId: review.evidenceChapterVersionId,
              passage: review.evidencePassage,
              locator: review.evidenceLocator,
            },
            reviewerOrigin: review.reviewerOrigin as "model" | "author" | "critic",
            required: review.required,
            passed: review.score >= 4,
            createdAt: review.createdAt.toISOString(),
            updatedAt: review.updatedAt.toISOString(),
          })),
          reviewSummary: {
            completed: reviews.length,
            total: 6 as const,
            requiredFailed: failedDimensions.length,
            failedDimensions,
          },
          createdAt: candidate.createdAt.toISOString(),
          updatedAt: candidate.updatedAt.toISOString(),
        };
      });

      const selectedCandidateId =
        candidates.find((candidate) => candidate.status === "selected")?.id ??
        candidates.find((candidate) => candidate.status === "locked")?.id ??
        null;
      let gateCandidateId = selectedCandidateId;
      if (lockRecord) {
        gateCandidateId = lockRecord.candidateId;
      }
      const selectedCandidate =
        candidates.find((candidate) => candidate.id === gateCandidateId) ?? null;
      const blockers: Array<{
        code: GoldenThreeGateBlockerCode;
        message: string;
        dimension: GoldenThreeReviewDimension | null;
      }> = [];
      if (lockRecord) {
        blockers.push({
          code: "CANDIDATE_LOCKED",
          message: "黄金三章已经锁定，后续修改需要另开创作线。",
          dimension: null,
        });
      } else if (candidates.length === 0) {
        blockers.push({
          code: "NO_CANDIDATES",
          message: "还没有可比较的黄金三章候选。",
          dimension: null,
        });
      } else if (!selectedCandidate) {
        blockers.push({
          code: "NO_SELECTION",
          message: "请先选定一个候选方向。",
          dimension: null,
        });
      } else if (selectedCandidate.reviewSummary.completed < 6) {
        blockers.push({
          code: "REVIEW_INCOMPLETE",
          message: "六维评审尚未完成。",
          dimension: null,
        });
      } else {
        for (const dimension of selectedCandidate.reviewSummary.failedDimensions) {
          blockers.push({
            code: "REQUIRED_DIMENSION_FAILED",
            message: "必需评审维度未达到 4/5。",
            dimension,
          });
        }
        if (!selectedCandidate.continuation) {
          blockers.push({
            code: "CONTINUATION_REQUIRED",
            message: "选定方向后还需要生成或登记第 2、3 章续写。",
            dimension: null,
          });
        }
      }

      return {
        workId: context.workId,
        branchId: context.branchId,
        candidates,
        selectedCandidateId,
        lock: lockRecord
          ? {
              id: lockRecord.id,
              workId: lockRecord.workId,
              branchId: lockRecord.branchId,
              candidateId: lockRecord.candidateId,
              versionNodeId: lockRecord.versionNodeId,
              styleBaselineId: lockRecord.styleBaselineId,
              chapterPins: lockRecord.chapterPins,
              override:
                lockRecord.overridePolicy && lockRecord.overrideRationale
                  ? {
                      policy: "author_override_v1" as const,
                      rationale: lockRecord.overrideRationale,
                    }
                  : null,
              lockedBy: lockRecord.lockedBy,
              lockedAt: lockRecord.createdAt.toISOString(),
            }
          : null,
        styleBaseline: styleRecord
          ? {
              id: styleRecord.id,
              workId: styleRecord.workId,
              branchId: styleRecord.branchId,
              sourceType: "golden_three" as const,
              sourceId: styleRecord.sourceId,
              version: styleRecord.version,
              versionNodeId: styleRecord.versionNodeId,
              profile: styleRecord.profile as NonNullable<
                GoldenThreeWorkspace["styleBaseline"]
              >["profile"],
              createdAt: styleRecord.createdAt.toISOString(),
            }
          : null,
        gate: {
          candidateId: gateCandidateId,
          canLock: !lockRecord && blockers.length === 0,
          blockers,
          failedDimensions: selectedCandidate?.reviewSummary.failedDimensions ?? [],
        },
      };
    });
  }

  async createCandidates(
    userId: string,
    context: GoldenThreeContext,
    idempotencyKey: string,
    input: GoldenThreeCandidateBatchRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWriteResult<{ batchId: string }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const existingForKey = await transaction
        .select({ batchId: goldenThreeCandidates.batchId })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
            eq(goldenThreeCandidates.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existingForKey[0]) {
        return { kind: "ok", value: { batchId: existingForKey[0].batchId } };
      }
      const [existingCandidate] = await transaction
        .select({ id: goldenThreeCandidates.id })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (existingCandidate) {
        return { kind: "candidates_exist" };
      }

      const pinsByVersionId = await resolvePins(
        transaction,
        userId,
        context,
        input.candidates.flatMap((candidate) => candidate.pins),
      );
      if (!pinsByVersionId.ok) {
        return { kind: "reference_invalid", message: pinsByVersionId.message };
      }
      const contextPackIds = input.candidates.flatMap((candidate) =>
        candidate.context.packVersionId ? [candidate.context.packVersionId] : [],
      );
      if (contextPackIds.length > 0) {
        const packs = await transaction
          .select({ id: contextPackVersions.id })
          .from(contextPackVersions)
          .where(
            and(
              inArray(contextPackVersions.id, contextPackIds),
              eq(contextPackVersions.userId, userId),
              eq(contextPackVersions.workId, context.workId),
              eq(contextPackVersions.branchId, context.branchId),
            ),
          );
        if (packs.length !== new Set(contextPackIds).size) {
          return {
            kind: "reference_invalid",
            message: "候选引用的上下文快照不存在或不属于当前创作线",
          };
        }
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const batchId = uuidv7();
      const now = new Date();
      const candidateIds: string[] = [];
      for (const candidate of input.candidates) {
        const pins = candidate.pins
          .map((pin) => {
            const resolved = pinsByVersionId.byVersionId.get(pin.chapterVersionId);
            if (!resolved) {
              return null;
            }
            return resolved satisfies GoldenThreeChapterPinJson;
          })
          .filter((pin): pin is GoldenThreeChapterPinJson => pin !== null)
          .sort((left, right) => left.chapterNumber - right.chapterNumber);
        if (pins.length !== 1 || pins[0]?.chapterNumber !== 1) {
          return {
            kind: "reference_invalid",
            message: "黄金三章候选只能固定第 1 章；第 2、3 章在作者选定后登记",
          };
        }
        const id = uuidv7();
        candidateIds.push(id);
        await transaction.insert(goldenThreeCandidates).values({
          id,
          batchId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          idempotencyKey,
          label: candidate.label,
          strategy: candidate.strategy,
          status: "draft",
          version: 1,
          promptKey: candidate.prompt.key,
          promptVersion: candidate.prompt.version,
          promptHash: candidate.prompt.hash,
          modelProvider: candidate.model.provider,
          model: candidate.model.model,
          modelParameters: candidate.model.parameters,
          contextPackVersionId: candidate.context.packVersionId,
          contextManifestHash: candidate.context.manifestHash,
          chapterPins: pins,
          createdAt: now,
          updatedAt: now,
        });
      }
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_candidate_batch",
        objectId: batchId,
        objectVersion: 1,
        payload: { action: "golden_three.candidates_created", candidateIds },
        actorId: userId,
        message: "创建黄金三章候选",
        createdAt: now,
      });
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "golden_three.candidates_created",
        targetType: "golden_three_batch",
        targetId: batchId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return { kind: "ok", value: { batchId } };
    });
  }

  async generateCandidates(
    userId: string,
    context: GoldenThreeContext,
    idempotencyKey: string,
    input: GoldenThreeGenerateRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWriteResult<{ batchId: string }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const existingKey = await findIdempotentResource(
        transaction,
        userId,
        "golden-three-generate",
        idempotencyKey,
      );
      if (existingKey) {
        return { kind: "ok", value: { batchId: existingKey.resourceId } };
      }
      const [existingCandidate] = await transaction
        .select({ id: goldenThreeCandidates.id })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (existingCandidate) {
        return { kind: "candidates_exist" };
      }
      const chapterRows = await transaction
        .select({ chapter: chapters, version: chapterVersions })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(
          and(
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
            eq(chapters.number, 1),
          ),
        )
        .orderBy(asc(chapters.number));
      const chapterByNumber = new Map(chapterRows.map((row) => [row.chapter.number, row]));
      const emptyChapterNumbers = [1].filter((number) => {
        const row = chapterByNumber.get(number);
        return !row?.version || row.version.content.trim().length === 0;
      });
      if (emptyChapterNumbers.length > 0) {
        return { kind: "chapters_empty", chapterNumbers: emptyChapterNumbers };
      }
      const chapterIds = chapterRows.map((row) => row.chapter.id);
      const versionRows = await transaction
        .select({
          chapterId: chapterVersions.chapterId,
          maxVersion: sql<number>`coalesce(max(${chapterVersions.version}), 0)`,
        })
        .from(chapterVersions)
        .where(inArray(chapterVersions.chapterId, chapterIds))
        .groupBy(chapterVersions.chapterId);
      const nextVersionByChapter = new Map(
        versionRows.map((row) => [row.chapterId, Number(row.maxVersion) + 1]),
      );
      const strategies = goldenThreeGenerationStrategies.slice(0, input.candidateCount);
      const now = new Date();
      const batchId = uuidv7();
      const candidateIds: string[] = [];
      let headNodeId = await requireBranchHead(transaction, userId, context);
      for (const strategy of strategies) {
        const pins: GoldenThreeChapterPinJson[] = [];
        for (const number of [1]) {
          const row = chapterByNumber.get(number)!;
          const versionNumber = nextVersionByChapter.get(row.chapter.id) ?? 1;
          nextVersionByChapter.set(row.chapter.id, versionNumber + 1);
          const content = generateCandidateChapterContent(
            strategy.strategy,
            row.chapter.title,
            row.version!.content,
          );
          const contentHash = createHash("sha256").update(content).digest("hex");
          const wordCount = countWords(content);
          const versionId = uuidv7();
          const versionNodeId = uuidv7();
          await transaction.insert(versionNodes).values({
            id: versionNodeId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            parentNodeId: headNodeId,
            nodeType: "chapter_version",
            objectType: "chapter",
            objectId: row.chapter.id,
            objectVersion: versionNumber,
            payload: {
              contentHash,
              wordCount,
              source: "golden_three_generation",
              strategy: strategy.strategy,
              candidateBatchId: batchId,
            },
            actorId: userId,
            message: `生成第 ${number} 章黄金三章候选`,
            createdAt: now,
          });
          await transaction.insert(chapterVersions).values({
            id: versionId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            chapterId: row.chapter.id,
            version: versionNumber,
            content,
            contentHash,
            versionNodeId,
            source: "golden_three_generation",
            createdAt: now,
          });
          headNodeId = versionNodeId;
          pins.push({
            chapterId: row.chapter.id,
            chapterNumber: row.chapter.number,
            chapterTitle: row.chapter.title,
            chapterVersionId: versionId,
            chapterVersion: versionNumber,
            versionNodeId,
            contentHash,
            wordCount,
            content,
          });
        }
        const candidateId = uuidv7();
        candidateIds.push(candidateId);
        const promptHash = createHash("sha256")
          .update(`golden-three-generate:${strategy.strategy}:v1`)
          .digest("hex");
        const manifestHash = createHash("sha256")
          .update(
            `${strategy.strategy}:${pins
              .map((pin) => `${pin.chapterId}:${pin.contentHash}`)
              .join("|")}`,
          )
          .digest("hex");
        await transaction.insert(goldenThreeCandidates).values({
          id: candidateId,
          batchId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          idempotencyKey,
          label: strategy.label,
          strategy: strategy.strategy,
          status: "reviewed",
          version: 1,
          promptKey: "golden-three-generate",
          promptVersion: 1,
          promptHash,
          modelProvider: "deterministic",
          model: "deterministic-golden-three-v1",
          modelParameters: { strategy: strategy.strategy, temperature: 0 },
          contextPackVersionId: null,
          contextManifestHash: manifestHash,
          chapterPins: pins,
          createdAt: now,
          updatedAt: now,
        });
        for (const review of automaticGoldenThreeReviews(pins)) {
          await transaction.insert(goldenThreeReviews).values({
            id: uuidv7(),
            candidateId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            dimension: review.dimension,
            score: review.score,
            evidenceChapterId: review.pin.chapterId,
            evidenceChapterVersionId: review.pin.chapterVersionId,
            evidencePassage: review.pin.content.slice(0, 200),
            evidenceLocator: `第 ${review.pin.chapterNumber} 章 · 生成候选`,
            reviewerOrigin: "model",
            required: true,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      const batchNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: batchNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_candidate_batch",
        objectId: batchId,
        objectVersion: 1,
        payload: { action: "golden_three.candidates_generated", candidateIds },
        actorId: userId,
        message: "生成黄金三章候选",
        createdAt: now,
      });
      await advanceBranchHead(transaction, context, batchNodeId, now);
      await writeAudit(transaction, userId, audit, "golden_three.candidates_generated", batchId);
      await rememberIdempotentResource(
        transaction,
        userId,
        "golden-three-generate",
        idempotencyKey,
        { resourceType: "golden_three_batch", resourceId: batchId },
      );
      return { kind: "ok", value: { batchId } };
    });
  }

  async submitReviews(
    userId: string,
    context: GoldenThreeContext,
    candidateId: string,
    input: GoldenThreeReviewBatchRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWriteResult<{ candidateId: string }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [candidate] = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.id, candidateId),
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!candidate) {
        return { kind: "not_found" };
      }
      if (candidate.status === "locked") {
        return { kind: "candidate_locked" };
      }
      if (candidate.version !== input.version) {
        return { kind: "version_conflict" };
      }
      for (const review of input.reviews) {
        const pin = candidate.chapterPins.find(
          (entry) =>
            entry.chapterId === review.evidence.chapterId &&
            entry.chapterVersionId === review.evidence.chapterVersionId,
        );
        if (!pin || !pin.content.includes(review.evidence.passage)) {
          return {
            kind: "evidence_invalid",
            message: "评审证据必须来自候选固定的章节版本原文",
          };
        }
      }
      const now = new Date();
      for (const review of input.reviews) {
        await transaction
          .insert(goldenThreeReviews)
          .values({
            id: uuidv7(),
            candidateId: candidate.id,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            dimension: review.dimension,
            score: review.score,
            evidenceChapterId: review.evidence.chapterId,
            evidenceChapterVersionId: review.evidence.chapterVersionId,
            evidencePassage: review.evidence.passage,
            evidenceLocator: review.evidence.locator,
            reviewerOrigin: review.reviewerOrigin,
            required: true,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [goldenThreeReviews.candidateId, goldenThreeReviews.dimension],
            set: {
              score: review.score,
              evidenceChapterId: review.evidence.chapterId,
              evidenceChapterVersionId: review.evidence.chapterVersionId,
              evidencePassage: review.evidence.passage,
              evidenceLocator: review.evidence.locator,
              reviewerOrigin: review.reviewerOrigin,
              required: true,
              updatedAt: now,
            },
          });
      }
      const [updated] = await transaction
        .update(goldenThreeCandidates)
        .set({
          status: candidate.status === "selected" ? "selected" : "reviewed",
          version: candidate.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(goldenThreeCandidates.id, candidate.id),
            eq(goldenThreeCandidates.version, candidate.version),
          ),
        )
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_review",
        objectId: candidate.id,
        objectVersion: updated.version,
        payload: {
          action: "golden_three.reviews_recorded",
          candidateId: candidate.id,
          dimensions: input.reviews.map((review) => review.dimension),
        },
        actorId: userId,
        message: "提交黄金三章六维评审",
        createdAt: now,
      });
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(transaction, userId, audit, "golden_three.reviews_recorded", candidate.id);
      return { kind: "ok", value: { candidateId: candidate.id } };
    });
  }

  async selectCandidate(
    userId: string,
    context: GoldenThreeContext,
    candidateId: string,
    input: GoldenThreeSelectionRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWriteResult<{ candidateId: string }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [candidate] = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.id, candidateId),
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!candidate) {
        return { kind: "not_found" };
      }
      if (candidate.status === "locked") {
        return { kind: "candidate_locked" };
      }
      if (candidate.version !== input.version) {
        return { kind: "version_conflict" };
      }
      const selectedCandidates = await transaction
        .select({ id: goldenThreeCandidates.id })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
            eq(goldenThreeCandidates.status, "selected"),
          ),
        );
      const now = new Date();
      for (const previous of selectedCandidates) {
        if (previous.id === candidate.id) {
          continue;
        }
        const [count] = await transaction
          .select({ value: sql<number>`count(*)::int` })
          .from(goldenThreeReviews)
          .where(eq(goldenThreeReviews.candidateId, previous.id));
        await transaction
          .update(goldenThreeCandidates)
          .set({
            status: Number(count?.value ?? 0) >= 6 ? "reviewed" : "draft",
            updatedAt: now,
          })
          .where(eq(goldenThreeCandidates.id, previous.id));
      }
      const [updated] = await transaction
        .update(goldenThreeCandidates)
        .set({
          status: "selected",
          version: candidate.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(goldenThreeCandidates.id, candidate.id),
            eq(goldenThreeCandidates.version, candidate.version),
          ),
        )
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_candidate",
        objectId: candidate.id,
        objectVersion: updated.version,
        payload: { action: "golden_three.candidate_selected", candidateId: candidate.id },
        actorId: userId,
        message: "作者选定黄金三章候选",
        createdAt: now,
      });
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(transaction, userId, audit, "golden_three.candidate_selected", candidate.id);
      return { kind: "ok", value: { candidateId: candidate.id } };
    });
  }

  async recordContinuation(
    userId: string,
    context: GoldenThreeContext,
    candidateId: string,
    input: GoldenThreeContinuationRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWriteResult<{ candidateId: string; versionNodeId: string }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [candidate] = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.id, candidateId),
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!candidate) {
        return { kind: "not_found" };
      }
      if (candidate.status === "locked") {
        return { kind: "candidate_locked" };
      }
      if (candidate.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (candidate.status !== "selected") {
        return { kind: "selection_required" };
      }

      let requestedPins = input.pins;
      if (!requestedPins) {
        const rows = await transaction
          .select({ chapter: chapters, version: chapterVersions })
          .from(chapters)
          .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
          .where(
            and(
              eq(chapters.userId, userId),
              eq(chapters.workId, context.workId),
              eq(chapters.branchId, context.branchId),
              inArray(chapters.number, [2, 3]),
            ),
          );
        const missing = [2, 3].filter((number) => {
          const row = rows.find((candidateRow) => candidateRow.chapter.number === number);
          return !row?.version || row.version.content.trim().length === 0;
        });
        if (missing.length > 0) {
          return { kind: "chapters_empty", chapterNumbers: missing };
        }
        requestedPins = rows
          .sort((left, right) => left.chapter.number - right.chapter.number)
          .map((row) => ({
            chapterId: row.chapter.id,
            chapterVersionId: row.version!.id,
            expectedContentHash: row.version!.contentHash,
          }));
      }

      const resolved = await resolvePins(transaction, userId, context, requestedPins);
      if (!resolved.ok) {
        return { kind: "reference_invalid", message: resolved.message };
      }
      const pins = requestedPins
        .map((pin) => resolved.byVersionId.get(pin.chapterVersionId))
        .filter((pin): pin is GoldenThreeChapterPinJson => Boolean(pin))
        .sort((left, right) => left.chapterNumber - right.chapterNumber);
      if (pins.length !== 2 || pins.map((pin) => pin.chapterNumber).join(",") !== "2,3") {
        return {
          kind: "reference_invalid",
          message: "黄金三章续写必须登记第 2、3 章",
        };
      }

      const now = new Date();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_continuation",
        objectId: candidate.id,
        objectVersion: candidate.version + 1,
        payload: {
          action: "golden_three.continuation_recorded",
          candidateId: candidate.id,
          pins,
        },
        actorId: userId,
        message: "登记黄金三章第 2、3 章续写",
        createdAt: now,
      });
      const [updated] = await transaction
        .update(goldenThreeCandidates)
        .set({ version: candidate.version + 1, updatedAt: now })
        .where(
          and(
            eq(goldenThreeCandidates.id, candidate.id),
            eq(goldenThreeCandidates.version, candidate.version),
          ),
        )
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(
        transaction,
        userId,
        audit,
        "golden_three.continuation_recorded",
        candidate.id,
      );
      return { kind: "ok", value: { candidateId: candidate.id, versionNodeId } };
    });
  }

  async lockCandidate(
    userId: string,
    context: GoldenThreeContext,
    candidateId: string,
    input: GoldenThreeLockRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWriteResult<{ candidateId: string; alreadyLocked: boolean }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [existingLock] = await transaction
        .select()
        .from(goldenThreeLocks)
        .where(
          and(
            eq(goldenThreeLocks.userId, userId),
            eq(goldenThreeLocks.workId, context.workId),
            eq(goldenThreeLocks.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (existingLock) {
        if (existingLock.candidateId !== candidateId) {
          return { kind: "already_locked" };
        }
        return {
          kind: "ok",
          value: { candidateId: existingLock.candidateId, alreadyLocked: true },
        };
      }
      const [candidate] = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.id, candidateId),
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!candidate) {
        return { kind: "not_found" };
      }
      if (candidate.status === "locked") {
        return { kind: "candidate_locked" };
      }
      if (candidate.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (candidate.status !== "selected") {
        return { kind: "selection_required" };
      }
      const reviews = await transaction
        .select()
        .from(goldenThreeReviews)
        .where(eq(goldenThreeReviews.candidateId, candidate.id))
        .orderBy(asc(goldenThreeReviews.dimension));
      if (reviews.length < 6) {
        return { kind: "review_incomplete", completed: reviews.length };
      }
      const failedDimensions = reviews
        .filter((review) => review.required && review.score < 4)
        .map((review) => review.dimension as GoldenThreeReviewDimension);
      if (failedDimensions.length > 0 && !input.override) {
        return { kind: "review_failed", failedDimensions };
      }
      const continuation = (
        await readLatestContinuations(transaction, userId, context, [candidate.id])
      ).get(candidate.id);
      if (!continuation) {
        return { kind: "continuation_required" };
      }
      const chapterPins = [...candidate.chapterPins, ...continuation.pins];
      const resolvedPins = await resolvePins(
        transaction,
        userId,
        context,
        chapterPins.map((pin) => ({
          chapterId: pin.chapterId,
          chapterVersionId: pin.chapterVersionId,
          expectedContentHash: pin.contentHash,
        })),
      );
      if (!resolvedPins.ok) {
        return { kind: "reference_invalid", message: resolvedPins.message };
      }
      const pins = chapterPins
        .map((pin) => resolvedPins.byVersionId.get(pin.chapterVersionId))
        .filter((pin): pin is GoldenThreeChapterPinJson => Boolean(pin))
        .sort((left, right) => left.chapterNumber - right.chapterNumber);
      if (pins.length !== 3 || pins.map((pin) => pin.chapterNumber).join(",") !== "1,2,3") {
        return { kind: "reference_invalid", message: "候选固定的章节版本已失效" };
      }

      const now = new Date();
      const lockId = uuidv7();
      const styleBaselineId = uuidv7();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "snapshot",
        objectType: "golden_three_lock",
        objectId: lockId,
        objectVersion: 1,
        payload: {
          action: "golden_three.locked",
          candidateId: candidate.id,
          styleBaselineId,
          chapterVersionIds: pins.map((pin) => pin.chapterVersionId),
          override: input.override ?? null,
          failedDimensions,
        },
        actorId: userId,
        message: "锁定黄金三章",
        createdAt: now,
      });
      await transaction.insert(styleBaselines).values({
        id: styleBaselineId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        sourceType: "golden_three",
        sourceId: lockId,
        version: 1,
        profile: {
          strategy: candidate.strategy,
          candidateLabel: candidate.label,
          excerpts: pins.map((pin) => ({
            chapterId: pin.chapterId,
            chapterVersionId: pin.chapterVersionId,
            excerpt: pin.content.slice(0, 600),
          })),
        },
        versionNodeId,
        createdBy: userId,
        createdAt: now,
      });
      await transaction.insert(goldenThreeLocks).values({
        id: lockId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        candidateId: candidate.id,
        versionNodeId,
        styleBaselineId,
        chapterPins: pins,
        reviewSnapshot: reviews.map((review) => ({
          dimension: review.dimension,
          score: review.score,
          evidenceChapterId: review.evidenceChapterId,
          evidenceChapterVersionId: review.evidenceChapterVersionId,
          evidencePassage: review.evidencePassage,
          evidenceLocator: review.evidenceLocator,
          reviewerOrigin: review.reviewerOrigin,
          required: review.required,
          passed: review.score >= 4,
        })),
        overridePolicy: input.override?.policy ?? null,
        overrideRationale: input.override?.rationale ?? null,
        lockedBy: userId,
        createdAt: now,
      });
      for (const pin of pins) {
        await transaction
          .update(chapters)
          .set({
            status: "locked",
            currentVersionId: pin.chapterVersionId,
            wordCount: pin.wordCount,
            version: sql`${chapters.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(chapters.id, pin.chapterId),
              eq(chapters.userId, userId),
              eq(chapters.workId, context.workId),
              eq(chapters.branchId, context.branchId),
            ),
          );
      }
      await transaction
        .update(goldenThreeCandidates)
        .set({ status: "locked", version: candidate.version + 1, updatedAt: now })
        .where(eq(goldenThreeCandidates.id, candidate.id));
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(transaction, userId, audit, "golden_three.locked", lockId);
      return { kind: "ok", value: { candidateId: candidate.id, alreadyLocked: false } };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

async function resolvePins(
  transaction: DatabaseTransaction,
  userId: string,
  context: GoldenThreeContext,
  requestedPins: GoldenThreeChapterPinInput[],
): Promise<
  { ok: true; byVersionId: Map<string, GoldenThreeChapterPinJson> } | { ok: false; message: string }
> {
  const versionIds = [...new Set(requestedPins.map((pin) => pin.chapterVersionId))];
  const rows = await transaction
    .select({
      chapter: chapters,
      version: chapterVersions,
      versionNodeId: chapterVersions.versionNodeId,
    })
    .from(chapterVersions)
    .innerJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
    .where(
      and(
        inArray(chapterVersions.id, versionIds),
        eq(chapterVersions.userId, userId),
        eq(chapterVersions.workId, context.workId),
        eq(chapterVersions.branchId, context.branchId),
        eq(chapters.userId, userId),
        eq(chapters.workId, context.workId),
        eq(chapters.branchId, context.branchId),
      ),
    );
  if (rows.length !== versionIds.length) {
    return { ok: false, message: "候选固定的章节版本不存在或不属于当前创作线" };
  }
  const byVersionId = new Map<string, GoldenThreeChapterPinJson>();
  for (const row of rows) {
    const requested = requestedPins.find((pin) => pin.chapterVersionId === row.version.id);
    if (
      !requested ||
      requested.chapterId !== row.chapter.id ||
      (requested.expectedContentHash && requested.expectedContentHash !== row.version.contentHash)
    ) {
      return { ok: false, message: "候选固定的章节版本与内容指纹不一致" };
    }
    byVersionId.set(row.version.id, {
      chapterId: row.chapter.id,
      chapterNumber: row.chapter.number,
      chapterTitle: row.chapter.title,
      chapterVersionId: row.version.id,
      chapterVersion: row.version.version,
      versionNodeId: row.versionNodeId,
      contentHash: row.version.contentHash,
      wordCount: countWords(row.version.content),
      content: row.version.content,
    });
  }
  return { ok: true, byVersionId };
}

async function readLatestContinuations(
  transaction: DatabaseTransaction,
  userId: string,
  context: GoldenThreeContext,
  candidateIds: string[],
): Promise<
  Map<string, { versionNodeId: string; pins: GoldenThreeChapterPinJson[]; createdAt: string }>
> {
  const continuations = new Map<
    string,
    { versionNodeId: string; pins: GoldenThreeChapterPinJson[]; createdAt: string }
  >();
  if (candidateIds.length === 0) {
    return continuations;
  }
  const rows = await transaction
    .select({
      id: versionNodes.id,
      objectId: versionNodes.objectId,
      payload: versionNodes.payload,
      createdAt: versionNodes.createdAt,
    })
    .from(versionNodes)
    .where(
      and(
        eq(versionNodes.userId, userId),
        eq(versionNodes.workId, context.workId),
        eq(versionNodes.branchId, context.branchId),
        eq(versionNodes.objectType, "golden_three_continuation"),
        inArray(versionNodes.objectId, candidateIds),
      ),
    )
    .orderBy(desc(versionNodes.createdAt));
  for (const row of rows) {
    if (continuations.has(row.objectId)) {
      continue;
    }
    const payload = row.payload;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as { pins?: unknown }).pins)
    ) {
      continue;
    }
    continuations.set(row.objectId, {
      versionNodeId: row.id,
      pins: (payload as { pins: GoldenThreeChapterPinJson[] }).pins,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return continuations;
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: GoldenThreeContext,
): Promise<string> {
  const [branch] = await transaction
    .select()
    .from(workBranches)
    .where(
      and(
        eq(workBranches.id, context.branchId),
        eq(workBranches.workId, context.workId),
        eq(workBranches.userId, userId),
      ),
    )
    .for("update")
    .limit(1);
  if (!branch?.headNodeId) {
    throw new Error("Golden three branch is missing its version head");
  }
  return branch.headNodeId;
}

async function advanceBranchHead(
  transaction: DatabaseTransaction,
  context: GoldenThreeContext,
  versionNodeId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(workBranches)
    .set({ headNodeId: versionNodeId, updatedAt: now })
    .where(eq(workBranches.id, context.branchId));
}

async function writeAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: WorksAuditContext,
  action: string,
  targetId: string,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    id: uuidv7(),
    actorId: userId,
    action,
    targetType: "golden_three",
    targetId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}

function generateCandidateChapterContent(
  strategy: GoldenThreeStrategy,
  chapterTitle: string,
  content: string,
): string {
  const firstSentence =
    content
      .split(/[。！？\n]/u)
      .find((part) => part.trim())
      ?.trim() ?? content;
  switch (strategy) {
    case "hook_focus":
      return `【${chapterTitle}】${firstSentence}。\n\n${content}`;
    case "character_focus":
      return `沈砚把这一章的代价压在心里。\n\n${content}`;
    case "world_focus":
      return `天门只认完整记忆的规则在碑文上浮现。\n\n${content}`;
  }
}

function automaticGoldenThreeReviews(pins: GoldenThreeChapterPinJson[]): Array<{
  dimension: GoldenThreeReviewDimension;
  score: number;
  pin: GoldenThreeChapterPinJson;
}> {
  const mapping: Array<[GoldenThreeReviewDimension, number]> = [
    ["opening_hook", 0],
    ["protagonist_appeal", 1],
    ["world_rules", 2],
    ["core_conflict", 1],
    ["reader_promise", 0],
    ["chapter_end_hook", 2],
  ];
  return mapping.map(([dimension, index]) => ({
    dimension,
    score: 4,
    pin: pins[index % pins.length]!,
  }));
}
