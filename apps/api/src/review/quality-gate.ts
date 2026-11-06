import type { CriticFindingCode, CriticSeverity, QualityGate } from "@novel-brain/contracts";
import { qualityFindings, type DatabaseClient } from "@novel-brain/db";
import { and, eq } from "drizzle-orm";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface OpenQualityFinding {
  id: string;
  code: CriticFindingCode;
  severity: CriticSeverity;
  structural: boolean;
  recommendation: string;
}

export async function listOpenQualityFindings(
  transaction: DatabaseTransaction,
  userId: string,
  chapterId: string,
  chapterVersionId: string,
): Promise<OpenQualityFinding[]> {
  const rows = await transaction
    .select({
      id: qualityFindings.id,
      code: qualityFindings.code,
      severity: qualityFindings.severity,
      structural: qualityFindings.structural,
      recommendation: qualityFindings.recommendation,
    })
    .from(qualityFindings)
    .where(
      and(
        eq(qualityFindings.userId, userId),
        eq(qualityFindings.chapterId, chapterId),
        eq(qualityFindings.chapterVersionId, chapterVersionId),
        eq(qualityFindings.status, "open"),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    code: row.code as CriticFindingCode,
    severity: row.severity as CriticSeverity,
    structural: row.structural,
    recommendation: row.recommendation,
  }));
}

export function qualityGateFromFindings(findings: OpenQualityFinding[]): QualityGate {
  const blockers = findings.flatMap((finding) => {
    const critical = finding.severity === "P0" || finding.severity === "P1";
    if (!critical && !finding.structural) {
      return [];
    }
    return [
      {
        findingId: finding.id,
        code: finding.code,
        severity: finding.severity,
        gate: critical ? ("both" as const) : ("canon_commit" as const),
        message: finding.recommendation,
      },
    ];
  });
  return {
    canApprove: !findings.some((finding) => finding.severity === "P0" || finding.severity === "P1"),
    canCommitCanon: !findings.some(
      (finding) => finding.severity === "P0" || finding.severity === "P1" || finding.structural,
    ),
    blockers,
  };
}

export async function qualityGateForChapterVersion(
  transaction: DatabaseTransaction,
  userId: string,
  chapterId: string,
  chapterVersionId: string,
): Promise<QualityGate> {
  return qualityGateFromFindings(
    await listOpenQualityFindings(transaction, userId, chapterId, chapterVersionId),
  );
}
