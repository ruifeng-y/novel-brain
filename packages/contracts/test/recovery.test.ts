import { describe, expect, it } from "vitest";

import {
  RECOVERY_CHECKPOINT_SCHEMA_VERSION,
  generationCheckpointSchema,
  jobRecoveryRecordSchema,
  jobRecoveryRequestSchema,
} from "../src";

const JOB_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b1001";
const RECOVERY_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b1002";
const ACTOR_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b1003";
const VERSION_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b1004";

describe("recovery contracts", () => {
  it("normalizes legacy checkpoints and rejects unsupported future schema versions", () => {
    const legacy = generationCheckpointSchema.parse({
      step: "draft",
      payload: { chapterVersionId: VERSION_ID },
    });
    expect(legacy).toMatchObject({
      schemaVersion: RECOVERY_CHECKPOINT_SCHEMA_VERSION,
      revision: 0,
      step: "draft",
      inputHash: null,
      outputRefs: [],
    });

    const current = generationCheckpointSchema.parse({
      schemaVersion: RECOVERY_CHECKPOINT_SCHEMA_VERSION,
      revision: 3,
      step: "draft",
      inputHash: "a".repeat(64),
      outputRefs: [{ type: "chapter_version", id: VERSION_ID }],
      payload: { chapterVersionId: VERSION_ID },
    });
    expect(current.revision).toBe(3);
    expect(current.outputRefs).toEqual([{ type: "chapter_version", id: VERSION_ID }]);

    expect(() =>
      generationCheckpointSchema.parse({
        ...current,
        schemaVersion: RECOVERY_CHECKPOINT_SCHEMA_VERSION + 1,
      }),
    ).toThrow();
    expect(() =>
      generationCheckpointSchema.parse({
        ...current,
        outputRefs: [{ type: "", id: VERSION_ID }],
      }),
    ).toThrow();
  });

  it("requires reasoned idempotent recovery and records the committed resume point", () => {
    const request = {
      reason: "作者确认从失败步骤继续",
      idempotencyKey: "recover-job-once",
      expectedCheckpointVersion: 4,
      budget: {
        maxTokens: 60_000,
        maxCostCny: 5,
      },
    };
    expect(jobRecoveryRequestSchema.parse(request)).toEqual(request);
    expect(() => jobRecoveryRequestSchema.parse({ ...request, reason: " " })).toThrow();
    expect(() => jobRecoveryRequestSchema.parse({ ...request, unexpected: true })).toThrow();
    expect(() =>
      jobRecoveryRequestSchema.parse({
        ...request,
        budget: {},
      }),
    ).toThrow();
    expect(() =>
      jobRecoveryRequestSchema.parse({
        ...request,
        budget: {
          maxTokens: 0,
        },
      }),
    ).toThrow();

    const record = {
      id: RECOVERY_ID,
      jobId: JOB_ID,
      actorId: ACTOR_ID,
      action: "retry",
      reason: request.reason,
      idempotencyKey: request.idempotencyKey,
      fromStatus: "failed",
      fromCheckpointVersion: 4,
      resumeStep: "draft",
      checkpointVersion: 5,
      createdAt: "2026-11-06T10:00:00.000Z",
    };
    expect(jobRecoveryRecordSchema.parse(record)).toEqual(record);
    expect(() => jobRecoveryRecordSchema.parse({ ...record, resumeStep: "" })).toThrow();
  });
});
