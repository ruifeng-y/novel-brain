import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { CanonCommitFact } from "@novel-brain/contracts";
import {
  auditLogs,
  canonCommits,
  chapterVersions,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  factDecisions,
  factProposals,
  facts as canonicalFacts,
  versionNodes,
  workBranches,
  works,
  withTenantTransaction,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import type { WorksAuditContext } from "../works/works.repository";
import { qualityGateForChapterVersion } from "../review/quality-gate";

export type ChapterRecord = InferSelectModel<typeof chapters>;
export type ChapterVersionRecord = InferSelectModel<typeof chapterVersions>;
export type FactProposalRecord = InferSelectModel<typeof factProposals>;
export type FactDecisionRecord = InferSelectModel<typeof factDecisions>;
export type CanonCommitRecord = InferSelectModel<typeof canonCommits>;
export type CanonFactRecord = InferSelectModel<typeof canonicalFacts>;
export type SubmittedFactRecord = CanonFactRecord & {
  proposalStatus: CanonCommitFact["status"];
};

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export type CanonSubmissionResult =
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "idempotency_conflict"; commitId: string; chapterVersionId: string }
  | { kind: "chapter_not_approved"; chapterStatus: string }
  | {
      kind: "quality_blocked";
      gate: Awaited<ReturnType<typeof qualityGateForChapterVersion>>;
    }
  | {
      kind: "blocked";
      pendingRequiredFactIds: string[];
      unresolvedHighRiskFactIds: string[];
      proposalCount: number;
    }
  | {
      kind: "committed";
      chapter: ChapterRecord;
      commit: CanonCommitRecord;
      facts: SubmittedFactRecord[];
    };

@Injectable()
export class CanonRepository implements OnModuleDestroy {
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

  async submit(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    chapterVersionId: string,
    idempotencyKey: string,
    audit: WorksAuditContext,
  ): Promise<CanonSubmissionResult> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
      const existing = await findCommit(transaction, userId, workId, branchId, chapterId);
      if (existing) {
        if (existing.chapterVersionId !== chapterVersionId) {
          return { kind: "version_conflict" };
        }
        if (existing.idempotencyKey !== idempotencyKey) {
          return {
            kind: "idempotency_conflict",
            commitId: existing.id,
            chapterVersionId: existing.chapterVersionId,
          };
        }
        const chapter = await findChapter(transaction, userId, workId, branchId, chapterId);
        if (!chapter) {
          return { kind: "not_found" };
        }
        return {
          kind: "committed",
          chapter,
          commit: existing,
          facts: await listSubmittedFacts(transaction, existing.id),
        };
      }

      const check = await evaluateSubmission(
        transaction,
        userId,
        workId,
        branchId,
        chapterId,
        chapterVersionId,
      );
      if (check.kind !== "ready") {
        return check;
      }
      const [branch] = await transaction
        .select()
        .from(workBranches)
        .where(
          and(
            eq(workBranches.id, branchId),
            eq(workBranches.workId, workId),
            eq(workBranches.userId, userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!branch?.headNodeId) {
        throw new Error("Canon submission branch is missing its version head");
      }

      const decisions = decisionSnapshot(check.proposals, check.decisions);
      const submittedProposals = check.proposals.filter(
        (proposal) => proposal.status === "confirmed" || proposal.status === "modified_confirmed",
      );
      const summary = buildSummary(check.chapter, decisions, submittedProposals.length);
      const now = new Date();
      const commitId = uuidv7();
      const versionNodeId = uuidv7();

      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId,
        branchId,
        userId,
        parentNodeId: branch.headNodeId,
        nodeType: "canon_commit",
        snapshotId: commitId,
        objectType: "chapter",
        objectId: chapterId,
        objectVersion: check.version.version,
        payload: {
          chapterId,
          chapterVersionId: check.version.id,
          sourceChapterNumber: check.chapter.number,
          sourceChapterTitle: check.chapter.title,
          decisions,
          summary,
        },
        actorId: userId,
        message: `提交第 ${check.chapter.number} 章事实`,
        createdAt: now,
      });
      const [commit] = await transaction
        .insert(canonCommits)
        .values({
          id: commitId,
          workId,
          branchId,
          userId,
          chapterId,
          chapterVersionId: check.version.id,
          versionNodeId,
          idempotencyKey,
          decisionSnapshot: decisions,
          summary,
          actorId: userId,
          createdAt: now,
        })
        .returning();
      if (!commit) {
        throw new Error("Failed to create canon commit");
      }
      const insertedFacts = submittedProposals.length
        ? await transaction
            .insert(canonicalFacts)
            .values(
              submittedProposals.map((proposal) => ({
                id: uuidv7(),
                workId,
                branchId,
                userId,
                chapterId,
                factProposalId: proposal.id,
                decisionId: requireDecision(check.decisions, proposal.id).id,
                sourceVersionId: check.version.id,
                canonCommitId: commit.id,
                subject: proposal.subject,
                predicate: proposal.predicate,
                object: proposal.object,
                risk: proposal.risk,
                required: proposal.required,
                status: "active",
                validFromChapter: check.chapter.number,
                createdAt: now,
              })),
            )
            .returning()
        : [];
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: now })
        .where(eq(workBranches.id, branchId));
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "canon.facts_submitted",
        targetType: "chapter",
        targetId: chapterId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });

      const proposalById = new Map(submittedProposals.map((proposal) => [proposal.id, proposal]));
      return {
        kind: "committed",
        chapter: check.chapter,
        commit,
        facts: insertedFacts.map((fact) => ({
          ...fact,
          proposalStatus: proposalStatus(proposalById.get(fact.factProposalId)),
        })),
      };
    });
  }

  async listCommits(
    userId: string,
    workId: string,
    branchId: string,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<
    | {
        commits: Array<Extract<CanonSubmissionResult, { kind: "committed" }>>;
        nextCursor: string | null;
      }
    | "not_found"
  > {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [context] = await transaction
        .select({ branchId: workBranches.id })
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
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      if (!context) {
        return "not_found";
      }
      const commits = await transaction
        .select()
        .from(canonCommits)
        .where(
          and(
            eq(canonCommits.userId, userId),
            eq(canonCommits.workId, workId),
            eq(canonCommits.branchId, branchId),
            page.cursor ? lt(canonCommits.id, page.cursor) : undefined,
          ),
        )
        .orderBy(desc(canonCommits.id))
        .limit(page.limit + 1);
      const hasMore = commits.length > page.limit;
      const pageCommits = hasMore ? commits.slice(0, page.limit) : commits;
      const nextCursor = hasMore ? (pageCommits.at(-1)?.id ?? null) : null;
      if (pageCommits.length === 0) {
        return { commits: [], nextCursor: null };
      }
      const chapterRows = await transaction
        .select()
        .from(chapters)
        .where(
          inArray(
            chapters.id,
            pageCommits.map((commit) => commit.chapterId),
          ),
        );
      const chapterById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]));
      const factRows = await transaction
        .select({
          fact: canonicalFacts,
          proposalStatus: factProposals.status,
        })
        .from(canonicalFacts)
        .innerJoin(factProposals, eq(factProposals.id, canonicalFacts.factProposalId))
        .where(
          inArray(
            canonicalFacts.canonCommitId,
            pageCommits.map((commit) => commit.id),
          ),
        )
        .orderBy(canonicalFacts.createdAt);
      const factsByCommit = new Map<string, SubmittedFactRecord[]>();
      for (const row of factRows) {
        const facts = factsByCommit.get(row.fact.canonCommitId) ?? [];
        facts.push({
          ...row.fact,
          proposalStatus:
            row.proposalStatus === "modified_confirmed" ? "modified_confirmed" : "confirmed",
        });
        factsByCommit.set(row.fact.canonCommitId, facts);
      }
      return {
        nextCursor,
        commits: pageCommits.flatMap((commit) => {
          const chapter = chapterById.get(commit.chapterId);
          if (!chapter) {
            return [];
          }
          return [
            {
              kind: "committed" as const,
              chapter,
              commit,
              facts: factsByCommit.get(commit.id) ?? [],
            },
          ];
        }),
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

async function evaluateSubmission(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapterId: string,
  chapterVersionId: string,
): Promise<
  | Exclude<CanonSubmissionResult, { kind: "committed" }>
  | {
      kind: "ready";
      chapter: ChapterRecord;
      version: ChapterVersionRecord;
      proposals: FactProposalRecord[];
      decisions: FactDecisionRecord[];
    }
> {
  const [row] = await transaction
    .select({
      chapter: chapters,
      version: chapterVersions,
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
    .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
    .where(
      and(
        eq(chapters.id, chapterId),
        eq(chapters.workId, workId),
        eq(chapters.branchId, branchId),
        eq(chapters.userId, userId),
        isNull(works.deletedAt),
      ),
    )
    .limit(1);
  if (!row?.version) {
    return { kind: "not_found" };
  }
  if (row.version.id !== chapterVersionId) {
    return { kind: "version_conflict" };
  }
  if (row.chapter.status !== "approved" && row.chapter.status !== "locked") {
    return { kind: "chapter_not_approved", chapterStatus: row.chapter.status };
  }
  const qualityGate = await qualityGateForChapterVersion(
    transaction,
    userId,
    workId,
    branchId,
    row.chapter.id,
    row.version.id,
  );
  if (!qualityGate.canCommitCanon) {
    return { kind: "quality_blocked", gate: qualityGate };
  }

  const proposals = await transaction
    .select()
    .from(factProposals)
    .where(
      and(
        eq(factProposals.userId, userId),
        eq(factProposals.workId, workId),
        eq(factProposals.branchId, branchId),
        eq(factProposals.chapterId, chapterId),
        eq(factProposals.sourceVersionId, row.version.id),
      ),
    );
  const decisions = await latestDecisions(
    transaction,
    proposals.map((proposal) => proposal.id),
  );
  const pendingRequiredFactIds = proposals
    .filter(
      (proposal) =>
        proposal.required &&
        proposal.status !== "confirmed" &&
        proposal.status !== "modified_confirmed",
    )
    .map((proposal) => proposal.id);
  const unresolvedHighRiskFactIds = proposals
    .filter((proposal) => proposal.risk === "high" && proposal.status === "proposed")
    .map((proposal) => proposal.id);
  if (
    proposals.length === 0 ||
    pendingRequiredFactIds.length > 0 ||
    unresolvedHighRiskFactIds.length > 0
  ) {
    return {
      kind: "blocked",
      pendingRequiredFactIds,
      unresolvedHighRiskFactIds,
      proposalCount: proposals.length,
    };
  }
  return {
    kind: "ready",
    chapter: row.chapter,
    version: row.version,
    proposals,
    decisions,
  };
}

async function latestDecisions(
  transaction: DatabaseTransaction,
  proposalIds: string[],
): Promise<FactDecisionRecord[]> {
  if (proposalIds.length === 0) {
    return [];
  }
  const decisions = await transaction
    .select()
    .from(factDecisions)
    .where(inArray(factDecisions.factProposalId, proposalIds))
    .orderBy(desc(factDecisions.decidedAt));
  return decisions.filter(
    (decision, index) =>
      decisions.findIndex((candidate) => candidate.factProposalId === decision.factProposalId) ===
      index,
  );
}

function decisionSnapshot(
  proposals: FactProposalRecord[],
  decisions: FactDecisionRecord[],
): Array<Record<string, unknown>> {
  return proposals.flatMap((proposal) => {
    const decision = decisions.find((candidate) => candidate.factProposalId === proposal.id);
    if (!decision) {
      return [];
    }
    return [
      {
        proposalId: proposal.id,
        decisionId: decision.id,
        action: decision.action,
        resultingStatus: proposal.status,
        subject: proposal.subject,
        predicate: proposal.predicate,
        object: proposal.object,
        risk: proposal.risk,
        required: proposal.required,
        sourceSentence: proposal.sourceSentence,
        actorName: decision.actorName,
        reason: decision.reason,
        decidedAt: decision.decidedAt.toISOString(),
      },
    ];
  });
}

function buildSummary(
  chapter: ChapterRecord,
  decisions: Array<Record<string, unknown>>,
  factCount: number,
): Record<string, unknown> {
  const rejectedCount = decisions.filter((decision) => decision.action === "reject").length;
  return {
    factCount,
    rejectedCount,
    text:
      `第 ${chapter.number} 章「${chapter.title}」：提交 ${factCount} 条事实` +
      (rejectedCount > 0 ? `，驳回 ${rejectedCount} 条` : "") +
      "。",
  };
}

function requireDecision(decisions: FactDecisionRecord[], proposalId: string): FactDecisionRecord {
  const decision = decisions.find((candidate) => candidate.factProposalId === proposalId);
  if (!decision) {
    throw new Error("Confirmed fact is missing its decision");
  }
  return decision;
}

function proposalStatus(proposal: FactProposalRecord | undefined): CanonCommitFact["status"] {
  if (proposal?.status === "modified_confirmed") {
    return "modified_confirmed";
  }
  return "confirmed";
}

async function findCommit(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapterId: string,
): Promise<CanonCommitRecord | undefined> {
  const [commit] = await transaction
    .select()
    .from(canonCommits)
    .where(
      and(
        eq(canonCommits.userId, userId),
        eq(canonCommits.workId, workId),
        eq(canonCommits.branchId, branchId),
        eq(canonCommits.chapterId, chapterId),
      ),
    )
    .limit(1);
  return commit;
}

async function findChapter(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapterId: string,
): Promise<ChapterRecord | undefined> {
  const [chapter] = await transaction
    .select()
    .from(chapters)
    .where(
      and(
        eq(chapters.id, chapterId),
        eq(chapters.userId, userId),
        eq(chapters.workId, workId),
        eq(chapters.branchId, branchId),
      ),
    )
    .limit(1);
  return chapter;
}

async function listSubmittedFacts(
  transaction: DatabaseTransaction,
  commitId: string,
): Promise<SubmittedFactRecord[]> {
  const rows = await transaction
    .select({
      fact: canonicalFacts,
      proposalStatus: factProposals.status,
    })
    .from(canonicalFacts)
    .innerJoin(factProposals, eq(factProposals.id, canonicalFacts.factProposalId))
    .where(eq(canonicalFacts.canonCommitId, commitId))
    .orderBy(canonicalFacts.createdAt);
  return rows.map(({ fact, proposalStatus: status }) => ({
    ...fact,
    proposalStatus: status === "modified_confirmed" ? "modified_confirmed" : "confirmed",
  }));
}
