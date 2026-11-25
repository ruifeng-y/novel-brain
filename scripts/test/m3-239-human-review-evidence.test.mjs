import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, "docs/quality/evidence/m3-239");

const readText = (fileName) => readFileSync(path.join(evidenceDir, fileName), "utf8");
const readJson = (fileName) => JSON.parse(readText(fileName));

describe("M3-239 human blind-review evidence", () => {
  const validation = readJson("validation.json");
  const humanScores = readJson("human-scores.json");

  it("records two reviewer filesets without claiming adjudication is complete", () => {
    expect(validation.status).toBe("blocked");
    expect(validation.technicalStatus).toBe("blocked");
    expect(validation.humanReviewRecorded).toBe(true);
    expect(validation.humanReviewCompleted).toBe(false);
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
    expect(validation.structuralBlockers).toContain("adjudication-pending:24");
    expect(validation.structuralBlockers).toContain("oracle-content-present:24");
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
        "decision-required:interRaterVarianceThreshold",
        "threshold-failed:hook_prose_score",
      ],
    });
    expect(validation.warnings).toContain("reviewer-completion-times-identical");
  });

  it("reproduces generated evidence from the raw packet and reviewer files", () => {
    const output = execFileSync(
      process.execPath,
      [path.join(evidenceDir, "validate-review.mjs"), "--check"],
      { cwd: root, encoding: "utf8" },
    );
    const result = JSON.parse(output);

    expect(result).toMatchObject({
      mode: "check",
      status: "blocked",
      technicalStatus: "blocked",
      humanReviewCompleted: false,
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
});
