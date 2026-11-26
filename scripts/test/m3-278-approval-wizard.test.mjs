import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeM3_278ApprovalPayloadSha256 } from "../m3-278-clean-packet.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(root, "scripts/m3-278-approval-wizard.ps1");
const templatePath = path.join(root, "docs/quality/evidence/m3-278/approvals.template.json");

describe("M3-278 approval wizard", () => {
  it("produces a non-freezable draft from 24 explicit review inputs", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const outputPath = path.join(temporaryRoot, "approvals.json");
    try {
      const result = runWizard(outputPath, "Draft");
      expect(result.status, result.stderr).toBe(0);

      const approvals = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(approvals.status).toBe("draft");
      expect(approvals.draftReviewComplete).toBe(true);
      expect(approvals.approvals).toHaveLength(24);
      expect(new Set(approvals.approvals.map((entry) => entry.blindSampleId)).size).toBe(24);
      expect(
        approvals.approvals.every(
          (entry) =>
            entry.decision === "approve" &&
            entry.adjudicatorKind === "draft" &&
            entry.adjudicatorId === "ruifeng-y" &&
            entry.attestationId === null &&
            entry.rationale.trim() &&
            entry.impact.trim() &&
            entry.decidedAt === null,
        ),
      ).toBe(true);
      expect(
        approvals.approvals
          .filter((entry) => entry.reviewDecisionPrompt)
          .every(
            (entry) =>
              entry.reviewDecision === "accept_current" && entry.reviewDecisionRationale.trim(),
          ),
      ).toBe(true);
      expect(approvals.humanAttestation.approvalPayloadSha256).toBeNull();
      expect(approvals.humanAttestation.commentUrl).toBeNull();

      const statement = runWizard(outputPath, "Statement");
      expect(statement.status).not.toBe(0);
      expect(statement.stderr).toContain("M3_278_APPROVALS_NOT_COMPLETE");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing approvals file without Force", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const outputPath = path.join(temporaryRoot, "approvals.json");
    try {
      expect(runWizard(outputPath, "Draft").status).toBe(0);
      const firstContent = readFileSync(outputPath, "utf8");
      const second = runWizard(outputPath, "Draft");

      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("M3_278_APPROVALS_EXISTS");
      expect(readFileSync(outputPath, "utf8")).toBe(firstContent);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("verifies a published GitHub attestation before completing approvals", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const isolatedRoot = prepareWizardRoot(temporaryRoot);
    const outputPath = path.join(isolatedRoot, "docs/quality/evidence/m3-278/approvals.json");
    const fakeBin = path.join(isolatedRoot, "bin");
    try {
      expect(runWizard(outputPath, "Draft", { rootDir: isolatedRoot }).status).toBe(0);
      const approvals = JSON.parse(readFileSync(outputPath, "utf8"));
      approvals.status = "complete";
      delete approvals.draftReviewComplete;
      for (const entry of approvals.approvals) {
        entry.adjudicatorKind = "human";
        entry.attestationId = `M3-278-APPROVAL-${entry.blindSampleId}`;
        entry.decidedAt = "2026-11-26T05:59:30.000Z";
      }
      const payloadHash = computeM3_278ApprovalPayloadSha256(approvals);
      approvals.humanAttestation.approvalPayloadSha256 = payloadHash;
      approvals.humanAttestation.statement = buildStatement(approvals);
      writeFileSync(outputPath, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");

      const responsePath = path.join(temporaryRoot, "attestation-response.txt");
      writeFileSync(
        responsePath,
        [
          "https://github.com/ruifeng-y/novel-brain/issues/278#issuecomment-7183183858",
          "ruifeng-y",
          "2026-11-26T06:00:20Z",
          "",
        ].join("\n"),
        "utf8",
      );
      const result = runWizard(outputPath, "Attestation", {
        responsePath,
        rootDir: isolatedRoot,
        env: {
          M3_278_FAKE_GH_BODY: approvals.humanAttestation.statement,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      });
      expect(result.status, result.stderr).toBe(0);

      const completed = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(completed.humanAttestation).toMatchObject({
        commentId: "7183183858",
        author: "ruifeng-y",
        approvalPayloadSha256: payloadHash,
      });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("does not accept a response file as interactive human review", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const outputPath = path.join(temporaryRoot, "approvals.json");
    const responsePath = path.join(temporaryRoot, "responses.txt");
    try {
      writeFileSync(responsePath, buildWizardInput(), "utf8");
      const result = runWizard(outputPath, "Review", { responsePath });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("M3_278_RESPONSE_FILE_NOT_ALLOWED_FOR_REVIEW");
      expect(() => readFileSync(outputPath, "utf8")).toThrow();
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects redirected stdin for formal review", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const outputPath = path.join(temporaryRoot, "approvals.json");
    try {
      const result = runWizard(outputPath, "Review", { input: buildWizardInput() });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("M3_278_REVIEW_REQUIRES_INTERACTIVE_CONSOLE");
      expect(() => readFileSync(outputPath, "utf8")).toThrow();
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps a rejected review item in a non-freezable draft", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const outputPath = path.join(temporaryRoot, "approvals.json");
    try {
      const result = runWizard(outputPath, "Draft", {
        response: buildWizardInput({ rejectFirst: true }),
      });
      expect(result.status, result.stderr).toBe(0);

      const approvals = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(approvals.status).toBe("draft");
      expect(approvals.draftReviewComplete).toBe(false);
      expect(approvals.approvals[0].decision).toBe("reject");

      const statement = runWizard(outputPath, "Statement");
      expect(statement.status).not.toBe(0);
      expect(statement.stderr).toContain("M3_278_APPROVALS_NOT_COMPLETE");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("cannot attest a draft approval file", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const outputPath = path.join(temporaryRoot, "approvals.json");
    const responsePath = path.join(temporaryRoot, "attestation-response.txt");
    try {
      expect(runWizard(outputPath, "Draft").status).toBe(0);
      writeFileSync(
        responsePath,
        [
          "https://github.com/ruifeng-y/novel-brain/issues/278#issuecomment-7183183858",
          "ruifeng-y",
          "2026-11-26T06:00:20Z",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = runWizard(outputPath, "Attestation", { responsePath });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("M3_278_APPROVALS_NOT_COMPLETE");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});

function runWizard(
  outputPath,
  mode = "Draft",
  { input, response, responsePath, rootDir, env = {} } = {},
) {
  let effectiveResponsePath = responsePath;
  if (mode === "Draft" && !effectiveResponsePath) {
    effectiveResponsePath = path.join(path.dirname(outputPath), "responses.txt");
    writeFileSync(effectiveResponsePath, response ?? buildWizardInput(), "utf8");
  }
  const responseArgs = effectiveResponsePath ? ["-ResponseFile", effectiveResponsePath] : [];
  const rootArgs = rootDir ? ["-Root", rootDir] : [];
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Mode",
      mode,
      ...rootArgs,
      "-OutputPath",
      outputPath,
      ...responseArgs,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
      input,
      timeout: 30_000,
    },
  );
}

function prepareWizardRoot(temporaryRoot) {
  const evidenceSource = path.join(root, "docs/quality/evidence/m3-278");
  const evidenceTarget = path.join(temporaryRoot, "docs/quality/evidence/m3-278");
  mkdirSync(evidenceTarget, { recursive: true });
  for (const filename of [
    "approvals.template.json",
    "replacement-candidates.source.json",
    "review-findings.source.json",
  ]) {
    copyFileSync(path.join(evidenceSource, filename), path.join(evidenceTarget, filename));
  }

  const scriptsTarget = path.join(temporaryRoot, "scripts");
  mkdirSync(scriptsTarget, { recursive: true });
  for (const filename of ["m3-278-clean-packet.mjs", "cli-entry.mjs"]) {
    copyFileSync(path.join(root, "scripts", filename), path.join(scriptsTarget, filename));
  }

  const fakeBin = path.join(temporaryRoot, "bin");
  mkdirSync(fakeBin, { recursive: true });
  copyFileSync(process.execPath, path.join(fakeBin, "gh.exe"));
  writeFileSync(
    path.join(temporaryRoot, "api"),
    `process.stdout.write(JSON.stringify({
  body: process.env.M3_278_FAKE_GH_BODY,
  issueUrl: "https://api.github.com/repos/ruifeng-y/novel-brain/issues/278",
  author: "ruifeng-y",
  authorAssociation: "OWNER",
  createdAt: "2026-11-26T06:00:20Z"
}));\n`,
    "utf8",
  );
  return temporaryRoot;
}

function buildWizardInput({ rejectFirst = false } = {}) {
  const lines = ["ruifeng-y"];
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  for (const [index, entry] of template.approvals.entries()) {
    lines.push(
      rejectFirst && index === 0 ? "reject" : "approve",
      "本人已逐项审阅候选叙事与节拍。",
      "批准进入 clean packet 候选。",
    );
    if (entry.reviewDecisionPrompt) {
      lines.push("accept_current", "同意已记录的负责人裁决。");
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildStatement(approvals) {
  return [
    "M3-278-HUMAN-APPROVAL",
    "",
    "本人 ruifeng-y 作为 NovelBrain product/quality owner，确认已逐项审阅并批准 24/24 replacement candidates。",
    "",
    `- Candidate packet SHA-256: ${approvals.candidatePacketSha256}`,
    `- Replacement manifest SHA-256: ${approvals.replacementManifestSha256}`,
    `- Approval payload SHA-256: ${approvals.humanAttestation.approvalPayloadSha256}`,
  ].join("\n");
}
