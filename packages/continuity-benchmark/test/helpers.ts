import type { ContinuityFinding } from "../src/evaluator";
import type { ContinuityFixture } from "../src/fixture";

export function findingsFor(fixture: ContinuityFixture): ContinuityFinding[] {
  return fixture.defects.map((defect) => ({
    family: defect.family,
    severity: defect.severity,
    chapterNumber: defect.chapterNumber,
    branchId: defect.branchId,
    entityIds: [...defect.entityIds],
    sourceFactId: defect.sourceFactId,
    versionNodeId: defect.versionNodeId,
    evidence: defect.evidence,
  }));
}
