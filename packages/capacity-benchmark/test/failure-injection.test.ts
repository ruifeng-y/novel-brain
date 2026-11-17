import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REQUIRED_FAILURE_SCENARIOS,
  validateFailureInjectionEvidenceShape,
  verifyFailureInjectionEvidence,
  type FailureInjectionEvidence,
} from "../src/failure-injection";

const runId = "capacity-test-run";
const sourceCommit = "a".repeat(40);

describe("failure injection evidence", () => {
  it("requires every scenario with a matching evidence file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "failure-injection-test-"));
    try {
      const evidence = await buildEvidence(root);

      await expect(
        verifyFailureInjectionEvidence(evidence, { runId, sourceCommit }, root),
      ).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects shell evidence without the required scenarios", () => {
    expect(
      validateFailureInjectionEvidenceShape(
        {
          status: "passed",
          runId,
          sourceCommit,
          scenarios: [],
        },
        { runId, sourceCommit },
      ),
    ).toBe(false);
  });

  it("rejects another workload run or a failed scenario", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "failure-injection-test-"));
    try {
      const evidence = await buildEvidence(root);
      evidence.scenarios[0] = {
        ...evidence.scenarios[0]!,
        status: "failed",
      };

      await expect(
        verifyFailureInjectionEvidence(evidence, { runId: "capacity-stale", sourceCommit }, root),
      ).resolves.toBe(false);
      await expect(
        verifyFailureInjectionEvidence(evidence, { runId, sourceCommit }, root),
      ).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing or modified scenario artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "failure-injection-test-"));
    try {
      const evidence = await buildEvidence(root);
      await writeFile(
        path.join(root, evidence.scenarios[0]!.evidencePath),
        '{"status":"tampered"}\n',
        "utf8",
      );
      await expect(
        verifyFailureInjectionEvidence(evidence, { runId, sourceCommit }, root),
      ).resolves.toBe(false);

      evidence.scenarios[0] = {
        ...evidence.scenarios[0]!,
        evidencePath: "missing.json",
      };
      await expect(
        verifyFailureInjectionEvidence(evidence, { runId, sourceCommit }, root),
      ).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function buildEvidence(root: string): Promise<FailureInjectionEvidence> {
  const scenarios: FailureInjectionEvidence["scenarios"] = [];
  for (const id of REQUIRED_FAILURE_SCENARIOS) {
    const relativePath = path.join("failure-injection", `${id}.json`);
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const detail = {
      runId,
      sourceCommit,
      scenario: id,
      status: "passed",
      observedAt: "2026-11-17T00:00:00.000Z",
    };
    const bytes = Buffer.from(`${JSON.stringify(detail, null, 2)}\n`, "utf8");
    await writeFile(absolutePath, bytes);
    scenarios.push({
      id,
      status: "passed",
      evidencePath: relativePath,
      evidenceSha256: createHash("sha256").update(bytes).digest("hex"),
      observedAt: detail.observedAt,
    });
  }
  return {
    status: "passed",
    runId,
    sourceCommit,
    scenarios,
  };
}
