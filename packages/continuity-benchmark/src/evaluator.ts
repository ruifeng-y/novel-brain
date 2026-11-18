import { createHash } from "node:crypto";

import type {
  ContinuityControl,
  ContinuityDefect,
  ContinuityFixture,
  ContinuityLocator,
} from "./fixture";
import type { ContinuitySeverity } from "./plan";
import { volumeNumberForChapter, volumePositionFor, type VolumePosition } from "./strata";

export interface ContinuityFinding extends ContinuityLocator {
  severity: ContinuitySeverity;
  sourceFactId: string;
  versionNodeId: string;
  evidence: string;
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
  fixtureSha256: string;
  findingsSha256: string;
  sha256: string;
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
  if (p0FalseNegatives > fixture.plan.thresholds.p0FactLossMax) {
    blockers.push("p0-fact-loss");
  }
  if (knowledgeBoundaryFalseNegatives > fixture.plan.thresholds.knowledgeBoundaryViolationMax) {
    blockers.push("knowledge-boundary-leak");
  }

  const evaluationWithoutHash = {
    fixtureSha256: fixture.digest.sha256,
    findingsSha256: sha256(findings),
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
  return {
    ...evaluationWithoutHash,
    sha256: sha256(evaluationWithoutHash),
  };
}

export function verifyContinuityEvaluation(evaluation: ContinuityEvaluation): boolean {
  const { sha256: recordedSha256, ...evaluationWithoutHash } = evaluation;
  return recordedSha256 === sha256(evaluationWithoutHash);
}

function matchesDefect(finding: ContinuityFinding, defect: ContinuityDefect): boolean {
  return (
    matchesLocator(finding, defect) &&
    finding.severity === defect.severity &&
    finding.sourceFactId === defect.sourceFactId &&
    finding.versionNodeId === defect.versionNodeId &&
    normalizeEvidence(finding.evidence) === normalizeEvidence(defect.evidence)
  );
}

function matchesControl(finding: ContinuityFinding, control: ContinuityControl): boolean {
  return matchesLocator(finding, control);
}

function matchesLocator(finding: ContinuityFinding, expected: ContinuityLocator): boolean {
  return (
    finding.family === expected.family &&
    finding.branchId === expected.branchId &&
    finding.chapterNumber === expected.chapterNumber &&
    intersects(finding.entityIds, expected.entityIds)
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
  return volumePositionFor(
    fixture.plan.volumeCount,
    volumeNumberForChapter(fixture.plan.chaptersPerVolume, chapterNumber),
  );
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return left.some((value) => right.includes(value));
}

function normalizeEvidence(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
