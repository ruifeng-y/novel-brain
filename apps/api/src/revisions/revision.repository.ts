import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  revisionFeedbackCreateRequestSchema,
  revisionFeedbackSchema,
  revisionPlanSchema,
  revisionPlanWorkspaceSchema,
  revisionRoundSchema,
  type RevisionConstraints,
  type RevisionFeedbackAction,
  type RevisionFeedbackCreateRequest,
  type RevisionManuscriptBlock,
  type RevisionPlanCreateRequest,
  type RevisionPlanWorkspace,
  type RevisionSelectedFinding,
} from "@novel-brain/contracts";
import { revisionFindingRisk, revisionRoundLimitReached } from "@novel-brain/core";
import {
  auditLogs,
  chapterVersions,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  jobs,
  qualityFindings,
  revisionFeedbackEvents,
  revisionPlans,
  revisionRounds,
  workBranches,
  works,
  type DatabaseClient,
  type RevisionBlockJson,
  type RevisionConstraintsJson,
  type RevisionSelectedFindingJson,
} from "@novel-brain/db";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type ChapterRecord = InferSelectModel<typeof chapters>;
type ChapterVersionRecord = InferSelectModel<typeof chapterVersions>;
type RevisionPlanRecord = InferSelectModel<typeof revisionPlans>;

export interface RevisionContext {
  workId: string;
  branchId: string;
  chapterId: string;
}

export interface RevisionBranchContext {
  workId: string;
  branchId: string;
}

export interface RevisionAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export type RevisionCreationResult =
  | {
      kind: "ok";
      created: boolean;
      planId: string;
      roundId: string;
      roundNumber: number;
      hasJob: boolean;
      sourceVersionId: string;
      selectedFindingIds: string[];
      blocks: RevisionManuscriptBlock[];
      constraints: RevisionConstraints;
      budget: RevisionPlanCreateRequest["budget"];
    }
  | { kind: "not_found" }
  | { kind: "not_editable" }
  | { kind: "source_invalid" }
  | { kind: "branch_stale" }
  | { kind: "finding_high_risk" }
  | { kind: "finding_invalid" }
  | { kind: "finding_rejected" }
  | { kind: "block_invalid" };

export type RevisionRoundCreationResult =
  | Extract<RevisionCreationResult, { kind: "ok" }>
  | { kind: "not_found" }
  | { kind: "not_editable" }
  | { kind: "source_invalid" }
  | { kind: "branch_stale" }
  | { kind: "finding_high_risk" }
  | { kind: "finding_invalid" }
  | { kind: "finding_rejected" }
  | { kind: "block_invalid" }
  | { kind: "round_limit" }
  | { kind: "invalid_state"; status: string }
  | { kind: "budget_exhausted" };

export type RevisionFeedbackResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "invalid_state"; status: string }
  | { kind: "finding_invalid" };

@Injectable()
export class RevisionRepository implements OnModuleDestroy {
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

  async createPlan(
    userId: string,
    context: RevisionContext,
    idempotencyKey: string,
    input: RevisionPlanCreateRequest,
    audit: RevisionAuditContext,
  ): Promise<RevisionCreationResult> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [existing] = await transaction
        .select()
        .from(revisionPlans)
        .where(
          and(
            eq(revisionPlans.userId, userId),
            eq(revisionPlans.chapterId, context.chapterId),
            eq(revisionPlans.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        const [round] = await transaction
          .select()
          .from(revisionRounds)
          .where(eq(revisionRounds.planId, existing.id))
          .orderBy(asc(revisionRounds.roundNumber))
          .limit(1);
        if (!round) {
          throw new Error("Revision plan is missing its first round");
        }
        return {
          kind: "ok",
          created: false,
          planId: existing.id,
          roundId: round.id,
          roundNumber: round.roundNumber,
          hasJob: round.jobId !== null,
          sourceVersionId: round.sourceVersionId,
          selectedFindingIds: round.selectedFindings.map((finding) => finding.findingId),
          blocks: round.blocks,
          constraints: round.constraints,
          budget: {
            maxCostCny: existing.maxCostCny,
            maxTokens: existing.maxTokens,
            maxRevisionRounds: existing.maxRounds,
          },
        };
      }

      const source = await loadEditableSource(transaction, userId, context, input.sourceVersionId);
      if (source.kind !== "loaded") {
        return source;
      }
      const selection = await loadSelection(transaction, userId, context, input, source.version);
      if (selection.kind !== "ok") {
        return selection;
      }
      const now = new Date();
      const planId = uuidv7();
      const roundId = uuidv7();
      const budget = input.budget;
      await transaction.insert(revisionPlans).values({
        id: planId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        chapterId: context.chapterId,
        sourceVersionId: input.sourceVersionId,
        idempotencyKey,
        status: "active",
        maxRounds: budget.maxRevisionRounds,
        maxCostCny: budget.maxCostCny,
        maxTokens: budget.maxTokens,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(revisionRounds).values({
        id: roundId,
        planId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        chapterId: context.chapterId,
        roundNumber: 1,
        status: "queued",
        sourceVersionId: input.sourceVersionId,
        selectedFindings: selection.selectedFindings as unknown as RevisionSelectedFindingJson[],
        blocks: selection.blocks as unknown as RevisionBlockJson[],
        constraints: selection.constraints as unknown as RevisionConstraintsJson,
        unresolvedFindingIds: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await writeAudit(
        transaction,
        userId,
        audit,
        "revision.plan_created",
        "revision_plan",
        planId,
      );
      return {
        kind: "ok",
        created: true,
        planId,
        roundId,
        roundNumber: 1,
        hasJob: false,
        sourceVersionId: input.sourceVersionId,
        selectedFindingIds: input.findingIds,
        blocks: selection.blocks,
        constraints: selection.constraints,
        budget,
      };
    });
  }

  async addRound(
    userId: string,
    context: RevisionContext,
    planId: string,
    input: RevisionPlanCreateRequest,
    audit: RevisionAuditContext,
  ): Promise<RevisionRoundCreationResult> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [plan] = await transaction
        .select()
        .from(revisionPlans)
        .where(
          and(
            eq(revisionPlans.id, planId),
            eq(revisionPlans.userId, userId),
            eq(revisionPlans.workId, context.workId),
            eq(revisionPlans.branchId, context.branchId),
            eq(revisionPlans.chapterId, context.chapterId),
          ),
        )
        .for("update")
        .limit(1);
      if (!plan) {
        return { kind: "not_found" };
      }
      if (plan.status === "completed" || plan.status === "rejected") {
        return { kind: "invalid_state", status: plan.status };
      }
      const rounds = await transaction
        .select()
        .from(revisionRounds)
        .where(eq(revisionRounds.planId, plan.id))
        .orderBy(asc(revisionRounds.roundNumber));
      const latest = rounds.at(-1);
      if (!latest) {
        throw new Error("Revision plan is missing its rounds");
      }
      if (latest.status !== "rewrite_requested") {
        return { kind: "invalid_state", status: latest.status };
      }
      if (revisionRoundLimitReached(rounds.length, plan.maxRounds)) {
        return { kind: "round_limit" };
      }
      const source = await loadEditableSource(transaction, userId, context, input.sourceVersionId);
      if (source.kind !== "loaded") {
        return source;
      }
      const selection = await loadSelection(
        transaction,
        userId,
        context,
        input,
        source.version,
        new Set(latest.selectedFindings.map((finding) => finding.findingId)),
      );
      if (selection.kind !== "ok") {
        return selection;
      }
      const remaining = await remainingBudget(transaction, plan);
      if (remaining === null) {
        return { kind: "budget_exhausted" };
      }
      const now = new Date();
      const roundId = uuidv7();
      const roundNumber = latest.roundNumber + 1;
      await transaction.insert(revisionRounds).values({
        id: roundId,
        planId: plan.id,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        chapterId: context.chapterId,
        roundNumber,
        status: "queued",
        sourceVersionId: input.sourceVersionId,
        selectedFindings: selection.selectedFindings as unknown as RevisionSelectedFindingJson[],
        blocks: selection.blocks as unknown as RevisionBlockJson[],
        constraints: selection.constraints as unknown as RevisionConstraintsJson,
        unresolvedFindingIds: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await transaction
        .update(revisionPlans)
        .set({ status: "active", version: plan.version + 1, updatedAt: now })
        .where(eq(revisionPlans.id, plan.id));
      await writeAudit(
        transaction,
        userId,
        audit,
        "revision.round_created",
        "revision_plan",
        plan.id,
      );
      return {
        kind: "ok",
        created: true,
        planId: plan.id,
        roundId,
        roundNumber,
        hasJob: false,
        sourceVersionId: input.sourceVersionId,
        selectedFindingIds: input.findingIds,
        blocks: selection.blocks,
        constraints: selection.constraints,
        budget: remaining,
      };
    });
  }

  async attachJob(
    userId: string,
    context: RevisionBranchContext,
    planId: string,
    roundId: string,
    jobId: string,
    audit: RevisionAuditContext,
  ): Promise<void> {
    await this.withTenant(userId, async (transaction) => {
      const [round] = await transaction
        .select()
        .from(revisionRounds)
        .where(
          and(
            eq(revisionRounds.id, roundId),
            eq(revisionRounds.planId, planId),
            eq(revisionRounds.userId, userId),
            eq(revisionRounds.workId, context.workId),
            eq(revisionRounds.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!round) {
        return;
      }
      if (!round.jobId) {
        await transaction
          .update(revisionRounds)
          .set({ jobId, status: "queued", updatedAt: new Date() })
          .where(eq(revisionRounds.id, round.id));
      }
      await writeAudit(
        transaction,
        userId,
        audit,
        "revision.round_started",
        "revision_round",
        roundId,
      );
    });
  }

  async markRoundFailed(userId: string, planId: string, roundId: string): Promise<void> {
    await this.withTenant(userId, async (transaction) => {
      const [round] = await transaction
        .select()
        .from(revisionRounds)
        .where(and(eq(revisionRounds.id, roundId), eq(revisionRounds.planId, planId)))
        .for("update")
        .limit(1);
      if (!round || !["queued", "running"].includes(round.status)) {
        return;
      }
      const now = new Date();
      await transaction
        .update(revisionRounds)
        .set({
          status: "failed",
          version: round.version + 1,
          updatedAt: now,
          finishedAt: now,
        })
        .where(eq(revisionRounds.id, round.id));
    });
  }

  async feedback(
    userId: string,
    context: RevisionContext,
    planId: string,
    roundId: string,
    input: RevisionFeedbackCreateRequest,
    audit: RevisionAuditContext,
  ): Promise<RevisionFeedbackResult> {
    revisionFeedbackCreateRequestSchema.parse(input);
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [plan] = await transaction
        .select()
        .from(revisionPlans)
        .where(
          and(
            eq(revisionPlans.id, planId),
            eq(revisionPlans.userId, userId),
            eq(revisionPlans.workId, context.workId),
            eq(revisionPlans.branchId, context.branchId),
            eq(revisionPlans.chapterId, context.chapterId),
          ),
        )
        .for("update")
        .limit(1);
      if (!plan) {
        return { kind: "not_found" };
      }
      const [round] = await transaction
        .select()
        .from(revisionRounds)
        .where(and(eq(revisionRounds.id, roundId), eq(revisionRounds.planId, plan.id)))
        .for("update")
        .limit(1);
      if (!round || !round.resultVersionId) {
        return { kind: "not_found" };
      }
      if (round.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (round.status !== "waiting_review") {
        return { kind: "invalid_state", status: round.status };
      }
      if (
        input.findingId &&
        !round.selectedFindings.some((finding) => finding.findingId === input.findingId)
      ) {
        return { kind: "finding_invalid" };
      }
      const now = new Date();
      await transaction.insert(revisionFeedbackEvents).values({
        id: uuidv7(),
        planId: plan.id,
        roundId: round.id,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        chapterId: context.chapterId,
        findingId: input.findingId ?? null,
        action: input.action,
        reason: input.reason,
        targetVersionId: round.resultVersionId,
        evaluationOptIn: input.evaluationOptIn,
        actorId: userId,
        createdAt: now,
      });
      const transition = roundLevelTransition(input.action, Boolean(input.findingId));
      if (transition) {
        await transaction
          .update(revisionRounds)
          .set({
            status: transition.roundStatus,
            version: round.version + 1,
            updatedAt: now,
          })
          .where(eq(revisionRounds.id, round.id));
        await transaction
          .update(revisionPlans)
          .set({
            status: transition.planStatus,
            version: plan.version + 1,
            updatedAt: now,
            completedAt: transition.planStatus === "completed" ? now : plan.completedAt,
          })
          .where(eq(revisionPlans.id, plan.id));
      } else {
        await transaction
          .update(revisionRounds)
          .set({ version: round.version + 1, updatedAt: now })
          .where(eq(revisionRounds.id, round.id));
      }
      await writeAudit(
        transaction,
        userId,
        audit,
        `revision.feedback_${input.action}`,
        "revision_round",
        round.id,
      );
      return { kind: "ok" };
    });
  }

  async getPlan(
    userId: string,
    context: RevisionBranchContext,
    planId: string,
  ): Promise<RevisionPlanWorkspace | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [plan] = await transaction
        .select()
        .from(revisionPlans)
        .where(
          and(
            eq(revisionPlans.id, planId),
            eq(revisionPlans.userId, userId),
            eq(revisionPlans.workId, context.workId),
            eq(revisionPlans.branchId, context.branchId),
          ),
        )
        .limit(1);
      return plan ? buildWorkspace(transaction, plan, userId) : undefined;
    });
  }

  async listPlans(
    userId: string,
    context: RevisionContext,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<{ plans: RevisionPlanWorkspace[]; nextCursor: string | null } | "invalid_cursor"> {
    return this.withTenant(userId, async (transaction) => {
      if (page.cursor) {
        const [cursor] = await transaction
          .select({ id: revisionPlans.id })
          .from(revisionPlans)
          .where(
            and(
              eq(revisionPlans.userId, userId),
              eq(revisionPlans.workId, context.workId),
              eq(revisionPlans.branchId, context.branchId),
              eq(revisionPlans.chapterId, context.chapterId),
              eq(revisionPlans.id, page.cursor),
            ),
          )
          .limit(1);
        if (!cursor) {
          return "invalid_cursor";
        }
      }
      const plans = await transaction
        .select()
        .from(revisionPlans)
        .where(
          and(
            eq(revisionPlans.userId, userId),
            eq(revisionPlans.workId, context.workId),
            eq(revisionPlans.branchId, context.branchId),
            eq(revisionPlans.chapterId, context.chapterId),
            page.cursor ? lt(revisionPlans.id, page.cursor) : undefined,
          ),
        )
        .orderBy(desc(revisionPlans.id))
        .limit(page.limit + 1);
      const hasMore = plans.length > page.limit;
      const pagePlans = hasMore ? plans.slice(0, page.limit) : plans;
      return {
        plans: await Promise.all(
          pagePlans.map((plan) => buildWorkspace(transaction, plan, userId)),
        ),
        nextCursor: hasMore ? (pagePlans.at(-1)?.id ?? null) : null,
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}

async function loadEditableSource(
  transaction: DatabaseTransaction,
  userId: string,
  context: RevisionContext,
  sourceVersionId: string,
): Promise<
  | { kind: "loaded"; chapter: ChapterRecord; version: ChapterVersionRecord }
  | { kind: "not_found" }
  | { kind: "not_editable" }
  | { kind: "source_invalid" }
  | { kind: "branch_stale" }
> {
  const [row] = await transaction
    .select({
      chapter: chapters,
      version: chapterVersions,
      branch: workBranches,
    })
    .from(chapters)
    .innerJoin(works, and(eq(works.id, chapters.workId), eq(works.userId, chapters.userId)))
    .innerJoin(
      workBranches,
      and(
        eq(workBranches.id, chapters.branchId),
        eq(workBranches.workId, chapters.workId),
        eq(workBranches.userId, chapters.userId),
      ),
    )
    .innerJoin(
      chapterVersions,
      and(
        eq(chapterVersions.id, sourceVersionId),
        eq(chapterVersions.chapterId, chapters.id),
        eq(chapterVersions.userId, chapters.userId),
      ),
    )
    .where(
      and(
        eq(chapters.id, context.chapterId),
        eq(chapters.workId, context.workId),
        eq(chapters.branchId, context.branchId),
        eq(chapters.userId, userId),
        isNull(works.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!row) {
    return { kind: "not_found" };
  }
  if (!isChapterEditable(row.chapter.status)) {
    return { kind: "not_editable" };
  }
  if (row.branch.status !== "active") {
    return { kind: "branch_stale" };
  }
  if (row.chapter.currentVersionId !== sourceVersionId) {
    return { kind: "source_invalid" };
  }
  return { kind: "loaded", chapter: row.chapter, version: row.version };
}

async function loadSelection(
  transaction: DatabaseTransaction,
  userId: string,
  context: RevisionContext,
  input: RevisionPlanCreateRequest,
  sourceVersion: ChapterVersionRecord,
  allowedPriorFindingIds: ReadonlySet<string> = new Set(),
): Promise<
  | {
      kind: "ok";
      selectedFindings: RevisionSelectedFinding[];
      blocks: RevisionManuscriptBlock[];
      constraints: RevisionConstraints;
    }
  | { kind: "finding_high_risk" }
  | { kind: "finding_invalid" }
  | { kind: "finding_rejected" }
  | { kind: "block_invalid" }
> {
  const rows = await transaction
    .select()
    .from(qualityFindings)
    .where(
      and(
        eq(qualityFindings.userId, userId),
        eq(qualityFindings.workId, context.workId),
        eq(qualityFindings.branchId, context.branchId),
        eq(qualityFindings.chapterId, context.chapterId),
        inArray(qualityFindings.id, input.findingIds),
      ),
    );
  if (rows.length !== new Set(input.findingIds).size) {
    return { kind: "finding_invalid" };
  }
  if (
    rows.some(
      (finding) =>
        finding.status !== "open" ||
        finding.structural ||
        revisionFindingRisk(finding.severity) === null,
    )
  ) {
    return {
      kind: rows.some(
        (finding) => finding.structural || revisionFindingRisk(finding.severity) === null,
      )
        ? "finding_high_risk"
        : "finding_invalid",
    };
  }
  const rejected = await rejectedFindingIds(transaction, context.chapterId);
  if (input.findingIds.some((findingId) => rejected.has(findingId))) {
    return { kind: "finding_rejected" };
  }
  if (
    rows.some(
      (finding) =>
        finding.chapterVersionId !== sourceVersion.id && !allowedPriorFindingIds.has(finding.id),
    )
  ) {
    return { kind: "finding_invalid" };
  }
  const blocks = [...input.blocks].sort((left, right) => left.start - right.start);
  for (const block of blocks) {
    if (
      block.end > sourceVersion.content.length ||
      !sourceVersion.content.slice(block.start, block.end).trim()
    ) {
      return { kind: "block_invalid" };
    }
  }
  const byId = new Map(rows.map((finding) => [finding.id, finding]));
  const selectedFindings = input.findingIds.map((findingId): RevisionSelectedFinding => {
    const finding = byId.get(findingId)!;
    return {
      findingId: finding.id,
      code: finding.code as RevisionSelectedFinding["code"],
      severity: finding.severity as RevisionSelectedFinding["severity"],
      qualityDimension: finding.qualityDimension as RevisionSelectedFinding["qualityDimension"],
      recommendation: finding.recommendation,
      evidence: finding.evidence as RevisionSelectedFinding["evidence"],
    };
  });
  if (
    selectedFindings.some(
      (finding) =>
        !finding.evidence.some((evidence) =>
          blocks.some(
            (block) => block.start < evidence.endOffset && block.end > evidence.startOffset,
          ),
        ),
    )
  ) {
    return { kind: "finding_invalid" };
  }
  return {
    kind: "ok",
    selectedFindings,
    blocks,
    constraints: input.constraints,
  };
}

async function rejectedFindingIds(
  transaction: DatabaseTransaction,
  chapterId: string,
): Promise<Set<string>> {
  const rows = await transaction
    .select({
      findingId: revisionFeedbackEvents.findingId,
      selectedFindings: revisionRounds.selectedFindings,
    })
    .from(revisionFeedbackEvents)
    .innerJoin(revisionRounds, eq(revisionRounds.id, revisionFeedbackEvents.roundId))
    .where(
      and(
        eq(revisionFeedbackEvents.chapterId, chapterId),
        eq(revisionFeedbackEvents.action, "reject"),
      ),
    );
  const rejected = new Set<string>();
  for (const row of rows) {
    if (row.findingId) {
      rejected.add(row.findingId);
    } else {
      for (const finding of row.selectedFindings) {
        rejected.add(finding.findingId);
      }
    }
  }
  return rejected;
}

async function remainingBudget(
  transaction: DatabaseTransaction,
  plan: RevisionPlanRecord,
): Promise<RevisionPlanCreateRequest["budget"] | null> {
  const [spent] = await transaction
    .select({
      cost: sql<number>`coalesce(sum(coalesce((${jobs.cost}->>'costCny')::numeric, 0)), 0)`,
      tokens: sql<number>`coalesce(sum(coalesce((${jobs.cost}->>'totalTokens')::int, 0)), 0)`,
    })
    .from(revisionRounds)
    .innerJoin(jobs, eq(jobs.id, revisionRounds.jobId))
    .where(eq(revisionRounds.planId, plan.id));
  const remainingCost = Number((plan.maxCostCny - Number(spent?.cost ?? 0)).toFixed(8));
  const remainingTokens = plan.maxTokens - Number(spent?.tokens ?? 0);
  if (remainingCost <= 0 || remainingTokens <= 0) {
    return null;
  }
  return {
    maxCostCny: remainingCost,
    maxTokens: remainingTokens,
    maxRevisionRounds: plan.maxRounds,
  };
}

async function buildWorkspace(
  transaction: DatabaseTransaction,
  plan: RevisionPlanRecord,
  userId: string,
): Promise<RevisionPlanWorkspace> {
  const roundRows = await transaction
    .select({ round: revisionRounds, jobStatus: jobs.status })
    .from(revisionRounds)
    .leftJoin(jobs, eq(jobs.id, revisionRounds.jobId))
    .where(and(eq(revisionRounds.planId, plan.id), eq(revisionRounds.userId, userId)))
    .orderBy(asc(revisionRounds.roundNumber));
  const feedbackRows = await transaction
    .select()
    .from(revisionFeedbackEvents)
    .where(
      and(eq(revisionFeedbackEvents.planId, plan.id), eq(revisionFeedbackEvents.userId, userId)),
    )
    .orderBy(asc(revisionFeedbackEvents.createdAt));
  const feedback = feedbackRows.map((row) =>
    revisionFeedbackSchema.parse({
      id: row.id,
      planId: row.planId,
      roundId: row.roundId,
      workId: row.workId,
      branchId: row.branchId,
      chapterId: row.chapterId,
      findingId: row.findingId,
      action: row.action,
      reason: row.reason,
      targetVersionId: row.targetVersionId,
      evaluationOptIn: row.evaluationOptIn,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
    }),
  );
  return revisionPlanWorkspaceSchema.parse({
    plan: revisionPlanSchema.parse({
      id: plan.id,
      workId: plan.workId,
      branchId: plan.branchId,
      chapterId: plan.chapterId,
      sourceVersionId: plan.sourceVersionId,
      status: plan.status,
      maxRounds: plan.maxRounds,
      budget: {
        maxCostCny: plan.maxCostCny,
        maxTokens: plan.maxTokens,
        maxRevisionRounds: plan.maxRounds,
      },
      version: plan.version,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      completedAt: plan.completedAt?.toISOString() ?? null,
    }),
    rounds: roundRows.map(({ round, jobStatus }) =>
      revisionRoundSchema.parse({
        id: round.id,
        planId: round.planId,
        workId: round.workId,
        branchId: round.branchId,
        chapterId: round.chapterId,
        roundNumber: round.roundNumber,
        status: round.status,
        jobId: round.jobId,
        jobStatus,
        sourceVersionId: round.sourceVersionId,
        resultVersionId: round.resultVersionId,
        versionNodeId: round.versionNodeId,
        selectedFindings: round.selectedFindings,
        blocks: round.blocks,
        constraints: round.constraints,
        diff: round.diff,
        unresolvedFindingIds: round.unresolvedFindingIds,
        version: round.version,
        createdAt: round.createdAt.toISOString(),
        updatedAt: round.updatedAt.toISOString(),
        finishedAt: round.finishedAt?.toISOString() ?? null,
      }),
    ),
    feedback,
    evaluationFeedback: feedback.filter((event) => event.evaluationOptIn),
  });
}

function roundLevelTransition(
  action: RevisionFeedbackAction,
  findingScoped: boolean,
): {
  roundStatus: "accepted" | "rejected" | "rewrite_requested";
  planStatus: "active" | "completed" | "rejected";
} | null {
  if (action === "reject") {
    return { roundStatus: "rejected", planStatus: "rejected" };
  }
  if (findingScoped) {
    return null;
  }
  if (action === "accept") {
    return { roundStatus: "accepted", planStatus: "completed" };
  }
  return { roundStatus: "rewrite_requested", planStatus: "active" };
}

function isChapterEditable(status: string): boolean {
  return status === "planned" || status === "writing" || status === "changes_requested";
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function writeAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: RevisionAuditContext,
  action: string,
  targetType: string,
  targetId: string,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    id: uuidv7(),
    actorId: userId,
    action,
    targetType,
    targetId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}
