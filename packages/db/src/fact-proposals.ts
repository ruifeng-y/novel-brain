import { createHash } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import type { DatabaseClient } from "./client";
import { factDecisions, factProposals } from "./schema";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface FactProposalCandidate {
  subject: string;
  predicate: string;
  object: string;
  sourceSentence: string;
  risk: "low" | "medium" | "high";
  confidence: number;
  required: boolean;
}

export async function refreshFactProposals(
  transaction: DatabaseTransaction,
  input: {
    workId: string;
    branchId: string;
    userId: string;
    chapterId: string;
    sourceVersionId: string;
    actorName: string;
    candidates: FactProposalCandidate[];
    newId: () => string;
  },
) {
  const existing = await transaction
    .select()
    .from(factProposals)
    .where(
      and(
        eq(factProposals.userId, input.userId),
        eq(factProposals.workId, input.workId),
        eq(factProposals.branchId, input.branchId),
        eq(factProposals.chapterId, input.chapterId),
      ),
    )
    .orderBy(asc(factProposals.createdAt));
  if (existing.some((proposal) => proposal.sourceVersionId === input.sourceVersionId)) {
    return existing;
  }

  const pendingIds = existing
    .filter((proposal) => proposal.status === "proposed")
    .map((proposal) => proposal.id);
  if (pendingIds.length > 0) {
    const now = new Date();
    const superseded = await transaction
      .update(factProposals)
      .set({ status: "superseded", updatedAt: now })
      .where(inArray(factProposals.id, pendingIds))
      .returning();
    await transaction.insert(factDecisions).values(
      superseded.map((proposal) => ({
        id: input.newId(),
        workId: proposal.workId,
        branchId: proposal.branchId,
        userId: proposal.userId,
        chapterId: proposal.chapterId,
        factProposalId: proposal.id,
        action: "supersede",
        actorId: input.userId,
        actorName: input.actorName,
        reason: "正文已更新，旧事实提案自动替代",
        originalPayload: factPayload(proposal),
        resultingPayload: { ...factPayload(proposal), status: "superseded" },
        decidedAt: now,
      })),
    );
  }

  const now = new Date();
  await transaction.insert(factProposals).values(
    input.candidates.map((candidate) => ({
      id: input.newId(),
      workId: input.workId,
      branchId: input.branchId,
      userId: input.userId,
      chapterId: input.chapterId,
      sourceVersionId: input.sourceVersionId,
      extractionKey: extractionKey(candidate),
      subject: candidate.subject,
      predicate: candidate.predicate,
      object: candidate.object,
      sourceSentence: candidate.sourceSentence,
      status: "proposed",
      confidence: candidate.confidence,
      risk: candidate.risk,
      required: candidate.required,
      createdAt: now,
      updatedAt: now,
    })),
  );

  return transaction
    .select()
    .from(factProposals)
    .where(
      and(
        eq(factProposals.userId, input.userId),
        eq(factProposals.workId, input.workId),
        eq(factProposals.branchId, input.branchId),
        eq(factProposals.chapterId, input.chapterId),
      ),
    )
    .orderBy(asc(factProposals.createdAt));
}

function extractionKey(candidate: FactProposalCandidate): string {
  return createHash("sha256")
    .update(
      [candidate.subject, candidate.predicate, candidate.object, candidate.sourceSentence].join(
        "\u0000",
      ),
    )
    .digest("hex");
}

function factPayload(proposal: typeof factProposals.$inferSelect): Record<string, unknown> {
  return {
    subject: proposal.subject,
    predicate: proposal.predicate,
    object: proposal.object,
    risk: proposal.risk,
    status: proposal.status,
  };
}
