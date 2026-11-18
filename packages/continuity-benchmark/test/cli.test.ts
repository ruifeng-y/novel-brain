import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runContinuityCli } from "../src/cli";
import type { ContinuityFixture } from "../src/fixture";
import { findingsFor } from "./helpers";

describe("continuity benchmark cli", () => {
  it("creates reproducible fixture and blind-review artifacts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "continuity-cli-"));
    try {
      const planPath = path.join(directory, "plan.json");
      const fixturePath = path.join(directory, "fixture.json");
      const packetPath = path.join(directory, "packet.json");
      const oraclePath = path.join(directory, "oracle.json");
      const findingsPath = path.join(directory, "findings.json");
      const evaluationPath = path.join(directory, "evaluation.json");
      const narrativeEvidencePath = path.join(directory, "narrative-evidence.json");
      const reportPath = path.join(directory, "report.json");

      await runContinuityCli([
        "plan",
        "--seed",
        "20261118",
        "--tier",
        "smoke",
        "--output",
        planPath,
      ]);
      await runContinuityCli([
        "generate",
        "--seed",
        "20261118",
        "--tier",
        "smoke",
        "--source-commit",
        "abc1234",
        "--output",
        fixturePath,
      ]);
      await runContinuityCli([
        "review-plan",
        "--fixture",
        fixturePath,
        "--samples-per-stratum",
        "2",
        "--packet-output",
        packetPath,
        "--oracle-output",
        oraclePath,
      ]);

      const plan = JSON.parse(await readFile(planPath, "utf8")) as { chapterCount: number };
      const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as ContinuityFixture;
      const packet = JSON.parse(await readFile(packetPath, "utf8")) as { items: unknown[] };
      const oracle = JSON.parse(await readFile(oraclePath, "utf8")) as { items: unknown[] };
      expect(plan.chapterCount).toBe(12);
      expect(fixture.chapters).toHaveLength(12);
      expect(packet.items).toHaveLength(6);
      expect(oracle.items).toHaveLength(6);

      await writeFile(findingsPath, `${JSON.stringify(findingsFor(fixture), null, 2)}\n`, "utf8");
      await runContinuityCli([
        "evaluate",
        "--fixture",
        fixturePath,
        "--findings",
        findingsPath,
        "--output",
        evaluationPath,
      ]);

      const evaluation = JSON.parse(await readFile(evaluationPath, "utf8")) as {
        releaseGate: { passed: boolean };
      };
      expect(evaluation.releaseGate.passed).toBe(true);

      await writeFile(
        narrativeEvidencePath,
        `${JSON.stringify(
          {
            outlineAdherence: 0.9,
            hookProseScore: 4,
            continuityConflictsPer50k: 1,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await runContinuityCli([
        "report",
        "--fixture",
        fixturePath,
        "--evaluation",
        evaluationPath,
        "--review-packet",
        packetPath,
        "--review-oracle",
        oraclePath,
        "--narrative-evidence",
        narrativeEvidencePath,
        "--output",
        reportPath,
      ]);

      const report = JSON.parse(await readFile(reportPath, "utf8")) as {
        narrativeEvidence: { outlineAdherence: number } | null;
      };
      expect(report.narrativeEvidence?.outlineAdherence).toBe(0.9);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
