import {
  CRITIC_RULE_VERSION,
  QUALITY_RUBRIC_VERSION,
  type CriticFindingCode,
  type CriticSeverity,
  type QualityGate,
  type QualityReportState,
} from "@novel-brain/contracts";
import { qualityFindings, qualityReports, type DatabaseClient } from "@novel-brain/db";
import { and, desc, eq } from "drizzle-orm";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface OpenQualityFinding {
  id: string;
  code: CriticFindingCode;
  severity: CriticSeverity;
  structural: boolean;
  recommendation: string;
}

export interface QualityReportGateState {
  state: QualityReportState;
  reportId: string | null;
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

export function qualityGateFromFindings(
  findings: OpenQualityFinding[],
  report: QualityReportGateState = { state: "missing", reportId: null },
): QualityGate {
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
  const hasFreshReport = report.state === "fresh";
  return {
    canApprove:
      hasFreshReport &&
      !findings.some((finding) => finding.severity === "P0" || finding.severity === "P1"),
    canCommitCanon:
      hasFreshReport &&
      !findings.some(
        (finding) => finding.severity === "P0" || finding.severity === "P1" || finding.structural,
      ),
    reportState: report.state,
    reportId: report.reportId,
    blockers,
  };
}

export async function qualityGateForChapterVersion(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapterId: string,
  chapterVersionId: string,
): Promise<QualityGate> {
  return qualityGateFromFindings(
    await listOpenQualityFindings(transaction, userId, chapterId, chapterVersionId),
    await loadQualityReportState(
      transaction,
      userId,
      workId,
      branchId,
      chapterId,
      chapterVersionId,
    ),
  );
}

export async function loadQualityReportState(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapterId: string,
  chapterVersionId: string,
): Promise<QualityReportGateState> {
  const [report] = await transaction
    .select({
      id: qualityReports.id,
      rubricVersion: qualityReports.rubricVersion,
      ruleVersion: qualityReports.ruleVersion,
    })
    .from(qualityReports)
    .where(
      and(
        eq(qualityReports.userId, userId),
        eq(qualityReports.workId, workId),
        eq(qualityReports.branchId, branchId),
        eq(qualityReports.chapterId, chapterId),
        eq(qualityReports.chapterVersionId, chapterVersionId),
      ),
    )
    .orderBy(desc(qualityReports.createdAt))
    .limit(1);
  if (!report) {
    return { state: "missing", reportId: null };
  }
  if (
    report.rubricVersion !== QUALITY_RUBRIC_VERSION ||
    report.ruleVersion !== CRITIC_RULE_VERSION
  ) {
    return { state: "stale", reportId: report.id };
  }
  return { state: "fresh", reportId: report.id };
}
