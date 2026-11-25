import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeReviewStatus } from "./review-status.mjs";

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(evidenceDir, "../../../..");
const checkFilesOnly = process.argv.includes("--check-files");
const checkOnly = checkFilesOnly || process.argv.includes("--check");
const reviewId = "m3-239-2026-11-25";
const reviewerIds = ["reviewer-01", "reviewer-02"];
const dimensions = ["outline_adherence", "hook_prose_score"];
const allowedPacketSampleFields = ["blindSampleId", "genre", "requiredBeats", "text"];
const packets = readJson(path.join(evidenceDir, "packet.json"));
const key = readJson(path.join(evidenceDir, "key.json"));
const rubric = readJson(path.join(root, "docs/quality/quality-benchmark-v1.rubric.json"));
const dataset = readJson(path.join(root, "docs/quality/quality-benchmark-v1.dataset.json"));
const blockers = [];
const warnings = [];
const samples = new Map(packets.samples.map((sample) => [sample.blindSampleId, sample]));
const datasetSamples = new Map(
  [...dataset.chapterSamples, ...dataset.adversarialCases].map((sample) => [sample.id, sample]),
);
const datasetSampleIds = new Map(
  key.entries.map((entry) => [entry.blindSampleId, entry.datasetSampleId]),
);
const packetFile = fileEvidence(path.join(evidenceDir, "packet.json"));
const packetCanonicalSha256 = sha256CanonicalJson(packets.samples);
const adjudicationPath = path.join(evidenceDir, "adjudication.json");
const adjudication = exists(adjudicationPath) ? readJson(adjudicationPath) : null;
let packetContentMismatchCount = 0;
let unexpectedPacketFieldCount = 0;

if (packets.source.datasetSha256 !== dataset.manifest.datasetSha256) {
  blockers.push("packet-dataset-hash-mismatch");
}
if (packets.source.rubricSha256 !== rubric.sha256) {
  blockers.push("packet-rubric-hash-mismatch");
}
if (
  sha256CanonicalJson({
    datasetSha256: dataset.manifest.datasetSha256,
    rubricSha256: rubric.sha256,
  }) !== packets.source.gateBlindPacketSha256
) {
  blockers.push("gate-blind-packet-hash-mismatch");
}
if (samples.size !== packets.samples.length) {
  blockers.push("packet-blind-ids-not-unique");
}
if (datasetSampleIds.size !== packets.samples.length) {
  blockers.push("key-sample-coverage-mismatch");
}
for (const [blindSampleId, datasetSampleId] of datasetSampleIds) {
  const packetSample = samples.get(blindSampleId);
  const datasetSample = datasetSamples.get(datasetSampleId);
  if (!packetSample || !datasetSample) {
    blockers.push(`key-dataset-mapping-invalid:${blindSampleId}`);
    continue;
  }
  if (
    packetSample.genre !== datasetSample.genre ||
    normalize(packetSample.text) !== normalize(datasetSample.text) ||
    packetSample.requiredBeats.length !== datasetSample.requiredBeats.length ||
    packetSample.requiredBeats.some(
      (beat, index) => normalize(beat) !== normalize(datasetSample.requiredBeats[index]),
    )
  ) {
    packetContentMismatchCount += 1;
    blockers.push(`packet-dataset-content-mismatch:${blindSampleId}`);
  }
  if (Object.keys(packetSample).sort().join(",") !== allowedPacketSampleFields.join(",")) {
    unexpectedPacketFieldCount += 1;
    blockers.push(`packet-sample-fields-unexpected:${blindSampleId}`);
  }
}
const privacyScan = scanPrivacy(packets.samples);
privacyScan.reviewerPacketSchemaFieldsOnly = unexpectedPacketFieldCount === 0;
privacyScan.sourceContentMatchesFrozenSyntheticDataset =
  packetContentMismatchCount === 0 && datasetSampleIds.size === packets.samples.length;
privacyScan.privateManuscriptFieldsIncluded = !privacyScan.reviewerPacketSchemaFieldsOnly;
privacyScan.oracleFieldsIncluded = !privacyScan.reviewerPacketSchemaFieldsOnly;
privacyScan.defectMetadataTextSampleIds = packets.samples
  .filter((sample) => /与已确认事实|冲突|seeded defect|oracle/iu.test(sample.text))
  .map((sample) => sample.blindSampleId);
privacyScan.oracleContentIncluded = privacyScan.defectMetadataTextSampleIds.length > 0;
if (privacyScan.totalFindingCount !== 0) {
  blockers.push("reviewer-packet-privacy-scan-failed");
}
if (privacyScan.oracleContentIncluded) {
  blockers.push(`oracle-content-present:${privacyScan.defectMetadataTextSampleIds.length}`);
}

const reviewers = [];
const humanScores = [];
for (const reviewerId of reviewerIds) {
  const notes = readJson(path.join(evidenceDir, `${reviewerId}-notes.json`));
  const rows = parseCsv(
    readFileSync(path.join(evidenceDir, `${reviewerId}-scores.csv`), "utf8").replace(/^\uFEFF/u, ""),
  );
  const questionnaire = readFileSync(
    path.join(evidenceDir, `${reviewerId}-questionnaire.md`),
    "utf8",
  );
  const expectedRows = packets.samples.length * dimensions.length;
  if (rows.length !== expectedRows) {
    blockers.push(`${reviewerId}:score-row-count:${rows.length}:expected:${expectedRows}`);
  }
  if (notes.reviewerId !== reviewerId || notes.reviewerSlot !== reviewerId) {
    blockers.push(`${reviewerId}:notes-reviewer-id-mismatch`);
  }
  if (!isIsoTimestamp(notes.reviewedAt)) {
    blockers.push(`${reviewerId}:notes-reviewed-at-invalid`);
  }
  for (const field of [
    "independentlyCompleted",
    "understoodSyntheticSource",
    "didNotSeeModelIdentityOrGenerationStatus",
    "didNotConsultOtherReviewer",
  ]) {
    if (notes[field] !== true) {
      blockers.push(`${reviewerId}:attestation-${field}-not-true`);
    }
  }
  if (!notes.reviewerAttestationId?.trim()) {
    blockers.push(`${reviewerId}:attestation-id-missing`);
  } else if (/aidraft/iu.test(notes.reviewerAttestationId)) {
    blockers.push(`${reviewerId}:attestation-id-indicates-ai-draft`);
  }
  if (!signedQuestionnaire(questionnaire)) {
    blockers.push(`${reviewerId}:questionnaire-signature-or-date-blank`);
  }

  const sampleIds = new Set();
  const dimensionCounts = new Map();
  const attestationIds = new Set();
  const reviewedTimes = new Set();
  const rowKeys = new Set();
  for (const row of rows) {
    if (row.reviewer_id !== reviewerId) {
      blockers.push(`${reviewerId}:row-reviewer-id-mismatch`);
    }
    const sample = samples.get(row.blind_sample_id);
    if (!sample) {
      blockers.push(`${reviewerId}:unknown-blind-sample:${row.blind_sample_id}`);
      continue;
    }
    if (!dimensions.includes(row.dimension)) {
      blockers.push(`${reviewerId}:invalid-dimension:${row.dimension}`);
    }
    if (row.genre !== sample.genre) {
      blockers.push(`${reviewerId}:${row.blind_sample_id}:genre-mismatch`);
    }
    const rowKey = `${row.blind_sample_id}:${row.dimension}`;
    if (rowKeys.has(rowKey)) {
      blockers.push(`${reviewerId}:duplicate-score:${rowKey}`);
    }
    rowKeys.add(rowKey);
    sampleIds.add(row.blind_sample_id);
    dimensionCounts.set(row.dimension, (dimensionCounts.get(row.dimension) ?? 0) + 1);
    attestationIds.add(row.reviewer_attestation_id);
    reviewedTimes.add(row.reviewed_at);

    const value = Number(row.value);
    const confidence = Number(row.confidence);
    if (!Number.isFinite(value)) {
      blockers.push(`${reviewerId}:${rowKey}:score-not-numeric`);
    } else if (
      (row.dimension === "outline_adherence" && (value < 0 || value > 1)) ||
      (row.dimension === "hook_prose_score" && (value < 1 || value > 5))
    ) {
      blockers.push(`${reviewerId}:${rowKey}:score-out-of-range`);
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      blockers.push(`${reviewerId}:${rowKey}:confidence-out-of-range`);
    }

    const evidenceQuotes = [
      row.evidence_quote_1,
      row.evidence_quote_2,
      row.evidence_quote_3,
    ].filter((quote) => quote.trim());
    const normalizedText = normalize(sample.text);
    if (!evidenceQuotes.some((quote) => normalizedText.includes(normalize(quote)))) {
      blockers.push(`${reviewerId}:${rowKey}:evidence-not-in-sample`);
    }
    if (row.dimension === "outline_adherence") {
      const combinedEvidence = normalize(evidenceQuotes.join(" "));
      for (const beat of sample.requiredBeats) {
        if (!combinedEvidence.includes(normalize(beat))) {
          blockers.push(`${reviewerId}:${rowKey}:required-beat-evidence-missing`);
        }
      }
    }

    humanScores.push({
      sampleId: datasetSampleIds.get(row.blind_sample_id),
      blindSampleId: row.blind_sample_id,
      dimension: row.dimension,
      scorerType: "human_blind",
      scorerId: row.reviewer_id,
      value,
      evidenceQuote: evidenceQuotes[0] ?? "",
      evidenceQuotes,
      confidence,
      reviewerAttestationId: row.reviewer_attestation_id,
      reviewedAt: row.reviewed_at,
      blindPacketSha256: packets.source.gateBlindPacketSha256,
      reviewPacketFileSha256: packetFile.sha256,
      retainedConcern: row.retained_concern || null,
    });
  }

  if (sampleIds.size !== packets.samples.length) {
    blockers.push(`${reviewerId}:sample-coverage:${sampleIds.size}:expected:${packets.samples.length}`);
  }
  for (const dimension of dimensions) {
    if ((dimensionCounts.get(dimension) ?? 0) !== packets.samples.length) {
      blockers.push(
        `${reviewerId}:dimension-coverage:${dimension}:${dimensionCounts.get(dimension) ?? 0}`,
      );
    }
  }
  if (attestationIds.size !== 1 || !attestationIds.has(notes.reviewerAttestationId)) {
    blockers.push(`${reviewerId}:csv-notes-attestation-mismatch`);
  }
  if (reviewedTimes.size !== 1 || !reviewedTimes.has(notes.reviewedAt)) {
    blockers.push(`${reviewerId}:csv-notes-reviewed-at-mismatch`);
  }

  reviewers.push({
    reviewerId,
    reviewerDisplayName: notes.reviewerDisplayName,
    reviewerExpertise: notes.reviewerExpertise,
    reviewerAttestationId: notes.reviewerAttestationId,
    reviewedAt: notes.reviewedAt,
    retainedConcerns: notes.retainedConcerns ?? [],
    samplesRequiringAdjudication: notes.samplesRequiringAdjudication ?? [],
    sourceFiles: {
      questionnaire: fileEvidence(path.join(evidenceDir, `${reviewerId}-questionnaire.md`)),
      scores: fileEvidence(path.join(evidenceDir, `${reviewerId}-scores.csv`)),
      notes: fileEvidence(path.join(evidenceDir, `${reviewerId}-notes.json`)),
    },
  });
}

if (new Set(reviewers.map((reviewer) => reviewer.reviewerId)).size !== reviewerIds.length) {
  blockers.push("reviewer-ids-not-distinct");
}
if (
  new Set(reviewers.map((reviewer) => reviewer.reviewerAttestationId)).size !== reviewerIds.length
) {
  blockers.push("reviewer-attestation-ids-not-distinct");
}
if (new Set(reviewers.map((reviewer) => reviewer.reviewedAt)).size !== reviewerIds.length) {
  warnings.push("reviewer-completion-times-identical");
}

humanScores.sort(
  (left, right) =>
    left.sampleId.localeCompare(right.sampleId) ||
    left.scorerId.localeCompare(right.scorerId) ||
    left.dimension.localeCompare(right.dimension),
);

const thresholdResults = dimensions.map((dimension) => {
  const definition = rubric.dimensions.find((candidate) => candidate.id === dimension);
  const values = humanScores
    .filter((score) => score.dimension === dimension)
    .map((score) => score.value);
  const value = round(values.reduce((sum, score) => sum + score, 0) / values.length);
  const passed =
    definition.threshold.operator === "min"
      ? value >= definition.threshold.value
      : value <= definition.threshold.value;
  return {
    id: dimension,
    value,
    threshold: definition.threshold,
    passed,
  };
});
const observedMaxVariance = computeMaxVariance(humanScores);
const adjudicationSampleIds = [
  ...new Set(reviewers.flatMap((reviewer) => reviewer.samplesRequiringAdjudication)),
].sort();
const adjudicationById = new Map(
  (adjudication?.adjudications ?? []).map((entry) => [entry.blindSampleId, entry]),
);
const adjudicationEntries = Array.isArray(adjudication?.adjudications)
  ? adjudication.adjudications
  : [];
const duplicateAdjudicationIds = adjudicationEntries
  .map((entry) => entry?.blindSampleId)
  .filter((blindSampleId, index, values) => values.indexOf(blindSampleId) !== index);
const unknownAdjudicationIds = adjudicationEntries
  .map((entry) => entry?.blindSampleId)
  .filter((blindSampleId) => !adjudicationSampleIds.includes(blindSampleId));
if (adjudication) {
  if (
    adjudication.schemaVersion !== 1 ||
    adjudication.reviewId !== reviewId ||
    adjudication.status !== "complete"
  ) {
    blockers.push("adjudication-file-invalid");
  }
  if (duplicateAdjudicationIds.length > 0) {
    blockers.push(`adjudication-duplicate:${duplicateAdjudicationIds.length}`);
  }
  if (unknownAdjudicationIds.length > 0) {
    blockers.push(`adjudication-unknown-sample:${unknownAdjudicationIds.length}`);
  }
}
const completedAdjudicationIds =
  adjudication?.status === "complete"
    ? adjudicationSampleIds.filter((blindSampleId) => {
        const entry = adjudicationById.get(blindSampleId);
        return Boolean(
          entry?.datasetSampleId === datasetSampleIds.get(blindSampleId) &&
          hasText(entry?.decision) &&
          hasText(entry?.rationale) &&
          hasText(entry?.adjudicatorId) &&
          hasText(entry?.reviewerAttestationId) &&
          isIsoTimestamp(entry?.decidedAt),
        );
      })
    : [];
const unresolvedAdjudicationIds = adjudicationSampleIds.filter(
  (blindSampleId) => !completedAdjudicationIds.includes(blindSampleId),
);
if (unresolvedAdjudicationIds.length > 0) {
  blockers.push(`adjudication-pending:${unresolvedAdjudicationIds.length}`);
}
const structuralBlockers = [...new Set(blockers)].sort();
const technicalBlockers = structuralBlockers.filter(
  (blocker) => !blocker.startsWith("adjudication-pending:"),
);
const recordStructureStatus = technicalBlockers.length === 0 ? "passed" : "blocked";
const qualityBlockers = [
  ...thresholdResults.filter((result) => !result.passed).map((result) => `threshold-failed:${result.id}`),
  "decision-required:interRaterVarianceThreshold",
].sort();
const { technicalStatus, humanReviewCompleted, qualityGate } = computeReviewStatus({
  structuralBlockers,
  qualityBlockers,
});
const structuralStatus = humanReviewCompleted ? "passed" : "blocked";
const validation = {
  schemaVersion: 1,
  issue: 239,
  reviewId,
  status: structuralStatus,
  technicalStatus,
  recordStructureStatus,
  humanReviewRecorded: humanScores.length === packets.samples.length * dimensions.length * reviewerIds.length,
  humanReviewCompleted,
  reviewerIdentityEvidence: "self_attested_pseudonymous",
  datasetSha256: packets.source.datasetSha256,
  rubricSha256: packets.source.rubricSha256,
  gateBlindPacketSha256: packets.source.gateBlindPacketSha256,
  reviewerPacketFileSha256: packetFile.sha256,
  reviewerPacketCanonicalSha256: packetCanonicalSha256,
  expectedReviewers: reviewerIds.length,
  observedReviewers: new Set(humanScores.map((score) => score.scorerId)).size,
  expectedSamples: packets.samples.length,
  observedSamples: new Set(humanScores.map((score) => score.sampleId)).size,
  expectedHumanScores: packets.samples.length * dimensions.length * reviewerIds.length,
  observedHumanScores: humanScores.length,
  reviewers,
  thresholdResults,
  observedMaxVariance,
  interRaterVarianceThreshold: null,
  varianceThresholdDecisionIssue: "#240",
  qualityGate,
  structuralBlockers,
  adjudicationSampleIds,
  unresolvedAdjudicationIds,
  completedAdjudicationCount: completedAdjudicationIds.length,
  adjudicationFileStatus: adjudication ? "present" : "missing",
  duplicateAdjudicationIds,
  unknownAdjudicationIds,
  expectedAdjudicationFile: "docs/quality/evidence/m3-239/adjudication.json",
  warnings: [...new Set(warnings)].sort(),
  sourcePacket: fileEvidence(path.join(evidenceDir, "packet.json")),
  sourceKey: fileEvidence(path.join(evidenceDir, "key.json")),
  sourceDataset: fileEvidence(path.join(root, "docs/quality/quality-benchmark-v1.dataset.json")),
  sourceRubric: fileEvidence(path.join(root, "docs/quality/quality-benchmark-v1.rubric.json")),
  privacyScan,
};

const humanScoresEvidence = {
  schemaVersion: 1,
  reviewId: validation.reviewId,
  humanReviewCompleted: validation.humanReviewCompleted,
  datasetSha256: validation.datasetSha256,
  rubricSha256: validation.rubricSha256,
  gateBlindPacketSha256: validation.gateBlindPacketSha256,
  reviewerPacketFileSha256: validation.reviewerPacketFileSha256,
  reviewerPacketCanonicalSha256: validation.reviewerPacketCanonicalSha256,
  reviewers: reviewers.map((reviewer) => ({
    reviewerId: reviewer.reviewerId,
    reviewerDisplayName: reviewer.reviewerDisplayName,
    reviewerExpertise: reviewer.reviewerExpertise,
    reviewerAttestationId: reviewer.reviewerAttestationId,
    reviewedAt: reviewer.reviewedAt,
    retainedConcerns: reviewer.retainedConcerns,
    samplesRequiringAdjudication: reviewer.samplesRequiringAdjudication,
  })),
  adjudicationSampleIds: validation.adjudicationSampleIds,
  unresolvedAdjudicationIds: validation.unresolvedAdjudicationIds,
  humanScores,
};
const adjudicationTemplate = {
  schemaVersion: 1,
  reviewId: validation.reviewId,
  status: "unfilled",
  owner: "product-owner",
  instructions:
    "Record real adjudications for every flagged sample. Do not use this template to approve the inter-rater variance threshold.",
  adjudications: adjudicationSampleIds.map((blindSampleId) => ({
    blindSampleId,
    datasetSampleId: datasetSampleIds.get(blindSampleId),
    decision: null,
    rationale: null,
    adjudicatorId: null,
    reviewerAttestationId: null,
    decidedAt: null,
  })),
};
const outputs = [
  {
    file: path.join(evidenceDir, "human-scores.json"),
    content: `${JSON.stringify(humanScoresEvidence, null, 2)}\n`,
  },
  {
    file: path.join(evidenceDir, "validation.json"),
    content: `${JSON.stringify(validation, null, 2)}\n`,
  },
  {
    file: path.join(evidenceDir, "validation.md"),
    content: renderValidation(validation),
  },
  {
    file: path.join(evidenceDir, "adjudication.template.json"),
    content: `${JSON.stringify(adjudicationTemplate, null, 2)}\n`,
  },
];
const staleFiles = [];
if (checkOnly) {
  for (const output of outputs) {
    if (!exists(output.file) || readFileSync(output.file, "utf8") !== output.content) {
      staleFiles.push(path.relative(root, output.file).replaceAll("\\", "/"));
    }
  }
} else {
  for (const output of outputs) {
    writeText(output.file, output.content);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      mode: checkFilesOnly ? "check-files" : checkOnly ? "check" : "write",
      status: validation.status,
      technicalStatus: validation.technicalStatus,
      humanReviewCompleted: validation.humanReviewCompleted,
      thresholdResults: validation.thresholdResults,
      qualityGate: validation.qualityGate,
      warnings: validation.warnings,
      structuralBlockers: validation.structuralBlockers,
      staleFiles,
    },
    null,
    2,
  )}\n`,
);
process.exitCode =
  staleFiles.length > 0 || (!checkFilesOnly && technicalStatus !== "passed") ? 1 : 0;

function signedQuestionnaire(markdown) {
  const signature = markdown.match(/^- 评审人签名\/可审计化名:[ \t]*(.*?)\r?$/mu)?.[1]?.trim();
  const signedAt = markdown.match(/^- 签署日期:[ \t]*(.*?)\r?$/mu)?.[1]?.trim();
  return Boolean(signature && signedAt);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const [headers, ...values] = rows.filter((candidate) => candidate.some(Boolean));
  return values.map((candidate) =>
    Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""])),
  );
}

function computeMaxVariance(scores) {
  const grouped = new Map();
  for (const score of scores) {
    const key = `${score.sampleId}:${score.dimension}`;
    grouped.set(key, [...(grouped.get(key) ?? []), score.value]);
  }
  let maximum = 0;
  for (const values of grouped.values()) {
    if (values.length < 2) {
      continue;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    maximum = Math.max(maximum, variance);
  }
  return round(maximum);
}

function scanPrivacy(reviewSamples) {
  const patterns = {
    email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
    url: /https?:\/\//iu,
    mainLandMobile: /(?<!\d)1[3-9]\d{9}(?!\d)/u,
    privateKeyMarker: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    apiKeyAssignment: /\b(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/iu,
  };
  const results = Object.entries(patterns).map(([name, pattern]) => {
    const matches = reviewSamples.flatMap((sample) =>
      [...sample.text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].map(
        (match) => ({ blindSampleId: sample.blindSampleId, match: match[0] }),
      ),
    );
    return { name, count: matches.length, matches };
  });
  return {
    reviewerPacketOnlyUsesFrozenSyntheticSamples: true,
    privateManuscriptFieldsIncluded: false,
    oracleFieldsIncluded: false,
    patterns: results,
    totalFindingCount: results.reduce((sum, result) => sum + result.count, 0),
  };
}

function sha256CanonicalJson(value) {
  return createHash("sha256").update(JSON.stringify(canonicalizeJson(value))).digest("hex");
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entry]) => [entryKey, canonicalizeJson(entry)]),
    );
  }
  return value;
}

function renderValidation(report) {
  return `# M3-239 人工盲评证据校验

> Structural status: **${report.status.toUpperCase()}**
>
> Technical validation: **${report.technicalStatus.toUpperCase()}**
>
> Adjudication status: **${report.unresolvedAdjudicationIds.length === 0 ? "COMPLETE" : "PENDING"}**
>
> Quality gate: **${report.qualityGate.status.toUpperCase()}**

## Frozen evidence

- Dataset SHA-256: \`${report.datasetSha256}\`
- Rubric SHA-256: \`${report.rubricSha256}\`
- Evaluator gate hash: \`${report.gateBlindPacketSha256}\`
- Reviewer packet file SHA-256: \`${report.reviewerPacketFileSha256}\`
- Reviewer packet canonical SHA-256: \`${report.reviewerPacketCanonicalSha256}\`
- Reviewers: ${report.observedReviewers}/${report.expectedReviewers}
- Samples: ${report.observedSamples}/${report.expectedSamples}
- Human score rows: ${report.observedHumanScores}/${report.expectedHumanScores}

## Adjudication

- Human review recorded: ${report.humanReviewRecorded ? "yes" : "no"}
- Human review completed: ${report.humanReviewCompleted ? "yes" : "no"}
- Completed adjudications: ${report.completedAdjudicationCount}/${report.adjudicationSampleIds.length}
- Pending samples: ${report.unresolvedAdjudicationIds.length === 0 ? "none" : report.unresolvedAdjudicationIds.join(", ")}

## Thresholds

| Dimension | Observed | Rule | Status |
| --- | ---: | --- | --- |
${report.thresholdResults
  .map(
    (result) =>
      `| \`${result.id}\` | ${result.value} | ${result.threshold.operator} ${result.threshold.value} | ${result.passed ? "pass" : "fail"} |`,
  )
  .join("\n")}

## Release boundary

- Observed max inter-rater variance: ${report.observedMaxVariance}
- Approved inter-rater variance threshold: not recorded
- Threshold decision owner: #240
- Quality release gate blockers: ${report.qualityGate.blockers.map((blocker) => `\`${blocker}\``).join(", ")}
- Structural blockers: ${report.structuralBlockers.length === 0 ? "none" : report.structuralBlockers.map((blocker) => `\`${blocker}\``).join(", ")}

## Warnings

${report.warnings.length === 0 ? "- None" : report.warnings.map((warning) => `- \`${warning}\``).join("\n")}

The identical reviewer completion timestamp is retained as a warning because it is not forbidden by the frozen rubric. Reviewer attestations and independent-scoring declarations remain in the source files.
`;
}

function normalize(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function isIsoTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fileEvidence(filePath) {
  return {
    path: path.relative(root, filePath).replaceAll("\\", "/"),
    bytes: statSync(filePath).size,
    sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
  };
}

function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeText(filePath, value) {
  writeFileSync(filePath, value, "utf8");
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
