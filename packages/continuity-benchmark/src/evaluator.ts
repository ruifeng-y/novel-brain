import type { ContinuityControl, ContinuityDefect, ContinuityFixture } from "./fixture";
import type { ContinuityScenarioFamily, ContinuitySeverity } from "./plan";

export interface ContinuityFinding {
  family: ContinuityScenarioFamily;
  severity: ContinuitySeverity;
  chapterNumber: number;
  branchId: string;
  entityIds: readonly string[];
  sourceFactId?: string;
  versionNodeId?: string;
  evidence?: string;
}

export interface ContinuityMetrics {
  expectedCount: number;
  predictedCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
}

export interface ContinuityMetricGroup {
  key: string;
  metrics: ContinuityMetrics;
}

export interface ContinuityEvaluation {
  summary: ContinuityMetrics;
  byFamily: readonly ContinuityMetricGroup[];
  bySeverity: readonly ContinuityMetricGroup[];
  byVolumePosition: readonly ContinuityMetricGroup[];
  byBranch: readonly ContinuityMetricGroup[];
  missingFindings: readonly ContinuityDefect[];
  unexpectedFindings: readonly ContinuityFinding[];
  releaseGate: {
    passed: boolean;
    blockers: readonly string[];
    p0FalseNegatives: number;
    knowledgeBoundaryFalseNegatives: number;
  };
}

type VolumePosition = "early" | "middle" | "late";
type FindingKind = "tp" | "fp" | "fn" | "tn";

interface Classified {
  kind: FindingKind;
  key: string;
  severity: ContinuitySeverity | null;
  volumePosition: VolumePosition;
  branchId: string;
}

export function evaluateContinuityFindings(input: {
  fixture: ContinuityFixture;
  findings: readonly ContinuityFinding[];
}): ContinuityEvaluation {
  const { fixture, findings } = input;
  const usedFindings = new Set<number>();
  const missingFindings: ContinuityDefect[] = [];
  const classified: Classified[] = [];

  for (const defect of fixture.defects) {
    const findingIndex = findings.findIndex(
      (finding, index) => !usedFindings.has(index) && matchesDefect(finding, defect),
    );
    if (findingIndex >= 0) {
      usedFindings.add(findingIndex);
      classified.push(classifyDefect(fixture, defect, "tp"));
    } else {
      missingFindings.push(defect);
      classified.push(classifyDefect(fixture, defect, "fn"));
    }
  }

  const unexpectedFindings: ContinuityFinding[] = [];
  for (const [index, finding] of findings.entries()) {
    if (usedFindings.has(index)) {
      continue;
    }
    unexpectedFindings.push(finding);
    classified.push(classifyFinding(fixture, finding, "fp"));
  }

  const hitControls = fixture.controls.filter((control) =>
    unexpectedFindings.some((finding) => matchesControl(finding, control)),
  );
  for (const control of fixture.controls) {
    if (!hitControls.includes(control)) {
      classified.push(classifyControl(fixture, control, "tn"));
    }
  }

  const summary = metricsFor(classified);
  const p0FalseNegatives = classified.filter(
    (entry) => entry.kind === "fn" && entry.severity === "P0",
  ).length;
  const knowledgeBoundaryFalseNegatives = missingFindings.filter(
    (defect) => defect.family === "knowledge_boundary",
  ).length;
  const blockers: string[] = [];
  if (p0FalseNegatives > 0) {
    blockers.push("p0-fact-loss");
  }
  if (knowledgeBoundaryFalseNegatives > 0) {
    blockers.push("knowledge-boundary-leak");
  }

  return {
    summary,
    byFamily: groupMetrics(classified, (entry) => entry.key),
    bySeverity: groupMetrics(
      classified.filter((entry) => entry.severity !== null),
      (entry) => entry.severity!,
    ),
    byVolumePosition: groupMetrics(classified, (entry) => entry.volumePosition),
    byBranch: groupMetrics(classified, (entry) => entry.branchId),
    missingFindings,
    unexpectedFindings,
    releaseGate: {
      passed: blockers.length === 0,
      blockers,
      p0FalseNegatives,
      knowledgeBoundaryFalseNegatives,
    },
  };
}

function matchesDefect(finding: ContinuityFinding, defect: ContinuityDefect): boolean {
  return (
    finding.family === defect.family &&
    finding.branchId === defect.branchId &&
    finding.chapterNumber === defect.chapterNumber &&
    intersects(finding.entityIds, defect.entityIds)
  );
}

function matchesControl(finding: ContinuityFinding, control: ContinuityControl): boolean {
  return (
    finding.family === control.family &&
    finding.branchId === control.branchId &&
    finding.chapterNumber === control.chapterNumber &&
    intersects(finding.entityIds, control.entityIds)
  );
}

function classifyDefect(
  fixture: ContinuityFixture,
  defect: ContinuityDefect,
  kind: "tp" | "fn",
): Classified {
  return {
    kind,
    key: defect.family,
    severity: defect.severity,
    volumePosition: volumePosition(fixture, defect.chapterNumber),
    branchId: defect.branchId,
  };
}

function classifyFinding(
  fixture: ContinuityFixture,
  finding: ContinuityFinding,
  kind: "fp",
): Classified {
  return {
    kind,
    key: finding.family,
    severity: finding.severity,
    volumePosition: volumePosition(fixture, finding.chapterNumber),
    branchId: finding.branchId,
  };
}

function classifyControl(
  fixture: ContinuityFixture,
  control: ContinuityControl,
  kind: "tn",
): Classified {
  return {
    kind,
    key: control.family,
    severity: null,
    volumePosition: volumePosition(fixture, control.chapterNumber),
    branchId: control.branchId,
  };
}

function groupMetrics(
  classified: readonly Classified[],
  keyFor: (entry: Classified) => string,
): ContinuityMetricGroup[] {
  const groups = new Map<string, Classified[]>();
  for (const entry of classified) {
    const key = keyFor(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entries]) => ({ key, metrics: metricsFor(entries) }));
}

function metricsFor(classified: readonly Classified[]): ContinuityMetrics {
  const truePositives = classified.filter((entry) => entry.kind === "tp").length;
  const falsePositives = classified.filter((entry) => entry.kind === "fp").length;
  const falseNegatives = classified.filter((entry) => entry.kind === "fn").length;
  const trueNegatives = classified.filter((entry) => entry.kind === "tn").length;
  const expectedCount = truePositives + falseNegatives;
  const predictedCount = truePositives + falsePositives;
  return {
    expectedCount,
    predictedCount,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision: ratio(truePositives, predictedCount),
    recall: ratio(truePositives, expectedCount),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function volumePosition(fixture: ContinuityFixture, chapterNumber: number): VolumePosition {
  const ratio = chapterNumber / fixture.plan.chapterCount;
  if (ratio <= 1 / 3) {
    return "early";
  }
  if (ratio <= 2 / 3) {
    return "middle";
  }
  return "late";
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return left.some((value) => right.includes(value));
}
