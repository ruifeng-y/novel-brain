import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, "docs/quality/evidence/m3-239");
const { computeCheckExitCode, computeReviewStatus } = await import(
  pathToFileURL(path.join(evidenceDir, "review-status.mjs")).href
);

const readText = (fileName) => readFileSync(path.join(evidenceDir, fileName), "utf8");
const readJson = (fileName) => JSON.parse(readText(fileName));
const readRootJson = (filePath) => JSON.parse(readFileSync(path.join(root, filePath), "utf8"));

describe("M3-239 human blind-review evidence", () => {
  const validation = readJson("validation.json");
  const humanScores = readJson("human-scores.json");

  it("records two reviewer filesets without claiming adjudication is complete", () => {
    expect(validation.status).toBe("complete-with-warnings");
    expect(validation.technicalStatus).toBe("passed");
    expect(validation.humanReviewRecorded).toBe(true);
    expect(validation.scoreCaptureCompleted).toBe(true);
    expect(validation.blindReviewProtocolCompleted).toBe(false);
    expect(validation.cleanBlindReview).toBe(false);
    expect(validation.reviewerIdentityEvidence).toBe("self_attested_pseudonymous");
    expect(validation.datasetSha256).toBe(
      "90c8c8c44540ae99246e243ac16c1158d7cee3485ac4b5c1a901b3b7164e753b",
    );
    expect(validation.rubricSha256).toBe(
      "247a1fcc0c0ce58bca7faa8a93a8b0d0e39c4095fc2f1c5748767b53d6fc1b3b",
    );
    expect(validation.gateBlindPacketSha256).toBe(
      "91b3c844070a69a4eea51d6583d816d5d732d9ccad95f972a2d6a77b0287c2fb",
    );
    expect(validation.reviewerPacketFileSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(validation.reviewerPacketCanonicalSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(validation.reviewerPacketFileSha256).not.toBe(validation.gateBlindPacketSha256);
    expect(validation.observedReviewers).toBe(2);
    expect(validation.observedSamples).toBe(204);
    expect(validation.observedHumanScores).toBe(816);
    expect(validation.adjudicationSampleIds).toHaveLength(24);
    expect(validation.unresolvedAdjudicationIds).toHaveLength(24);
    expect(validation.completedAdjudicationCount).toBe(0);
    expect(validation.adjudicationFileStatus).toBe("missing");
    expect(validation.duplicateAdjudicationIds).toEqual([]);
    expect(validation.unknownAdjudicationIds).toEqual([]);
    expect(validation.duplicateDatasetSampleIds).toEqual([]);
    expect(validation.structuralBlockers).toEqual([]);
    expect(validation.reviewQualityBlockers).toEqual([
      "adjudication-pending:24",
      "oracle-content-present:24",
    ]);
    expect(humanScores.humanScores).toHaveLength(816);
  });

  it("keeps reviewer identity, signatures, timestamps and evidence in the frozen records", () => {
    for (const reviewer of validation.reviewers) {
      expect(reviewer.reviewerId).toMatch(/^reviewer-0[12]$/u);
      expect(reviewer.reviewerAttestationId).not.toMatch(/aidraft/iu);
      expect(Number.isFinite(Date.parse(reviewer.reviewedAt))).toBe(true);
      expect(reviewer.retainedConcerns.length).toBeGreaterThan(0);
      expect(reviewer.samplesRequiringAdjudication).toHaveLength(24);
    }

    const questionnaires = [
      readText("reviewer-01-questionnaire.md"),
      readText("reviewer-02-questionnaire.md"),
    ];
    for (const questionnaire of questionnaires) {
      expect(questionnaire).toMatch(/^### Q\d{3}/mu);
      expect(questionnaire.match(/^### Q\d{3}/gmu)).toHaveLength(204);
      expect(questionnaire).toMatch(/^- 评审人签名\/可审计化名: reviewer-0[12]\s*$/mu);
      expect(questionnaire).toMatch(/^- 签署日期: 2026-11-25\s*$/mu);
    }
  });

  it("records every score against the frozen packet without private-data findings", () => {
    const scores = humanScores.humanScores;
    expect(new Set(scores.map((score) => score.sampleId)).size).toBe(204);
    expect(new Set(scores.map((score) => score.dimension))).toEqual(
      new Set(["outline_adherence", "hook_prose_score"]),
    );
    expect(
      scores.every(
        (score) =>
          score.scorerType === "human_blind" &&
          score.blindPacketSha256 === validation.gateBlindPacketSha256 &&
          score.reviewPacketFileSha256 === validation.reviewerPacketFileSha256 &&
          score.evidenceQuotes.length > 0 &&
          score.confidence >= 0 &&
          score.confidence <= 1,
      ),
    ).toBe(true);
    expect(validation.privacyScan.totalFindingCount).toBe(0);
    expect(validation.privacyScan.privateManuscriptFieldsIncluded).toBe(false);
    expect(validation.privacyScan.oracleFieldsIncluded).toBe(false);
    expect(validation.privacyScan.oracleContentIncluded).toBe(true);
    expect(validation.privacyScan.defectMetadataTextSampleIds).toHaveLength(24);
    expect(validation.privacyScan.reviewerPacketSchemaFieldsOnly).toBe(true);
    expect(validation.privacyScan.sourceContentMatchesFrozenSyntheticDataset).toBe(true);
  });

  it("records the failed quality gate without approving a variance threshold", () => {
    expect(validation.thresholdResults).toEqual([
      {
        id: "outline_adherence",
        value: 1,
        threshold: { operator: "min", value: 0.9 },
        passed: true,
      },
      {
        id: "hook_prose_score",
        value: 1.882353,
        threshold: { operator: "min", value: 4 },
        passed: false,
      },
    ]);
    expect(validation.observedMaxVariance).toBe(0);
    expect(validation.interRaterVarianceThreshold).toBeNull();
    expect(validation.qualityGate).toEqual({
      status: "blocked",
      blockers: [
        "adjudication-pending:24",
        "decision-required:interRaterVarianceThreshold",
        "oracle-content-present:24",
        "threshold-failed:hook_prose_score",
      ],
    });
    expect(validation.warnings).toContain("reviewer-completion-times-identical");
    expect(validation.warnings).toContain("reviewer-identity-self-attested");
    expect(validation.warnings).toContain("adjudication-pending:24");
    expect(validation.warnings).toContain("oracle-content-present:24");
  });

  it("reproduces generated evidence from the raw packet and reviewer files", () => {
    const output = execFileSync(
      process.execPath,
      [path.join(evidenceDir, "validate-review.mjs"), "--check-files"],
      { cwd: root, encoding: "utf8" },
    );
    const result = JSON.parse(output);

    expect(result).toMatchObject({
      mode: "check-files",
      status: "complete-with-warnings",
      technicalStatus: "passed",
      scoreCaptureCompleted: true,
      blindReviewProtocolCompleted: false,
      staleFiles: [],
    });
  });

  it("returns success from --check when record evidence is complete despite quality warnings", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(evidenceDir, "validate-review.mjs"), "--check"],
      { cwd: root, encoding: "utf8" },
    );
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(output).toMatchObject({
      mode: "check",
      status: "complete-with-warnings",
      technicalStatus: "passed",
      scoreCaptureCompleted: true,
      blindReviewProtocolCompleted: false,
      staleFiles: [],
    });
  });

  it("provides a pending adjudication template without inventing decisions", () => {
    const template = readJson("adjudication.template.json");

    expect(template.status).toBe("unfilled");
    expect(template.adjudications).toHaveLength(24);
    expect(
      template.adjudications.every(
        (entry) =>
          entry.decision === null &&
          entry.rationale === null &&
          entry.adjudicatorId === null &&
          entry.reviewerAttestationId === null &&
          entry.decidedAt === null,
      ),
    ).toBe(true);
  });

  it("keeps the quality gate blocked when adjudication is the only blocker", () => {
    const result = computeReviewStatus({
      structuralBlockers: [],
      qualityBlockers: ["adjudication-pending:1"],
    });

    expect(result.status).toBe("complete-with-warnings");
    expect(result.technicalStatus).toBe("passed");
    expect(result.scoreCaptureCompleted).toBe(true);
    expect(result.qualityGate).toEqual({
      status: "blocked",
      blockers: ["adjudication-pending:1"],
    });
  });

  it("separates completed review structure from quality-gate approval", () => {
    const result = computeReviewStatus({
      structuralBlockers: [],
      qualityBlockers: ["decision-required:interRaterVarianceThreshold"],
    });

    expect(result.technicalStatus).toBe("passed");
    expect(result.scoreCaptureCompleted).toBe(true);
    expect(result.qualityGate).toEqual({
      status: "blocked",
      blockers: ["decision-required:interRaterVarianceThreshold"],
    });
  });

  it("computes non-zero check exits for technical blockers and stale files", () => {
    expect(
      computeCheckExitCode({
        technicalStatus: "blocked",
        staleFiles: [],
        checkFilesOnly: false,
      }),
    ).toBe(1);
    expect(
      computeCheckExitCode({
        technicalStatus: "blocked",
        staleFiles: [],
        checkFilesOnly: true,
      }),
    ).toBe(0);
    expect(
      computeCheckExitCode({
        technicalStatus: "passed",
        staleFiles: ["validation.json"],
        checkFilesOnly: true,
      }),
    ).toBe(1);
  });

  it("keeps threshold and quality-remediation follow-ups on the correct issues", () => {
    const capabilityEvidence = readRootJson(
      "docs/implementation/m3-236-non-ui-capability-evidence.json",
    );

    expect(capabilityEvidence.capabilities["EVAL-002"].gap.issue).toBe("#240");
    const thresholdReason = capabilityEvidence.capabilities["EVAL-002"].gap.reason;
    expect(thresholdReason).toContain("inter-rater variance threshold");
    expect(thresholdReason).not.toContain("oracle");
    expect(thresholdReason).not.toContain("hook/prose");
    expect(capabilityEvidence.capabilities["CONT-001"].gap.issue).toBe("#273");
    const remediationReason = capabilityEvidence.capabilities["CONT-001"].gap.reason;
    expect(remediationReason).not.toContain("inter-rater variance threshold");
    expect(remediationReason).toContain("缺陷元信息");
    expect(remediationReason).toContain("待裁决");
    expect(remediationReason).toContain("hook/prose");
  });
});
