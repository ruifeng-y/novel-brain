import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(root, "scripts/m3-278-approval-wizard.ps1");
const templatePath = path.join(root, "docs/quality/evidence/m3-278/approvals.template.json");

describe("M3-278 approval wizard", () => {
  it("collects 24 explicit human approvals and computes the payload hash", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const outputPath = path.join(temporaryRoot, "approvals.json");
    try {
      const result = runWizard(outputPath);
      expect(result.status, result.stderr).toBe(0);

      const approvals = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(approvals.status).toBe("complete");
      expect(approvals.approvals).toHaveLength(24);
      expect(new Set(approvals.approvals.map((entry) => entry.blindSampleId)).size).toBe(24);
      expect(
        approvals.approvals.every(
          (entry) =>
            entry.decision === "approve" &&
            entry.adjudicatorKind === "human" &&
            entry.adjudicatorId === "ruifeng-y" &&
            entry.attestationId === `M3-278-APPROVAL-${entry.blindSampleId}` &&
            entry.rationale.trim() &&
            entry.impact.trim() &&
            entry.decidedAt,
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
      expect(approvals.humanAttestation.approvalPayloadSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(approvals.humanAttestation.commentUrl).toBeNull();

      const statement = runWizard(outputPath, "Statement");
      expect(statement.status, statement.stderr).toBe(0);
      expect(statement.stdout).toContain("M3-278-HUMAN-APPROVAL");
      expect(statement.stdout).toContain(approvals.candidatePacketSha256);
      expect(statement.stdout).toContain(approvals.humanAttestation.approvalPayloadSha256);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing approvals file without Force", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "m3-278-wizard-"));
    const outputPath = path.join(temporaryRoot, "approvals.json");
    try {
      expect(runWizard(outputPath).status).toBe(0);
      const firstContent = readFileSync(outputPath, "utf8");
      const second = runWizard(outputPath);

      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("M3_278_APPROVALS_EXISTS");
      expect(readFileSync(outputPath, "utf8")).toBe(firstContent);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});

function runWizard(outputPath, mode = "Review") {
  const responsePath = path.join(path.dirname(outputPath), "responses.txt");
  const responseArgs =
    mode === "Review"
      ? (() => {
          writeFileSync(responsePath, buildWizardInput(), "utf8");
          return ["-ResponseFile", responsePath];
        })()
      : [];
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
      "-OutputPath",
      outputPath,
      ...responseArgs,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

function buildWizardInput() {
  const lines = ["ruifeng-y"];
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  for (const entry of template.approvals) {
    lines.push("approve", "本人已逐项审阅候选叙事与节拍。", "批准进入 clean packet 候选。");
    if (entry.reviewDecisionPrompt) {
      lines.push("accept_current", "同意已记录的负责人裁决。");
    }
  }
  return `${lines.join("\n")}\n`;
}
