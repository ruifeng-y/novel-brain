import { describe, expect, it } from "vitest";

import {
  WRITE_ACTION_JOB,
  writingActionOutputSchema,
  writingActionRequestSchema,
  workerJobSchema,
} from "../src";

const WORK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2001";
const BRANCH_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2002";
const CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2003";
const VERSION_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2004";
const JOB_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2005";
const ACTOR_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2006";
const MODEL_CONFIG_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2007";
const OUTPUT_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2008";
const NODE_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b2009";
const provenance = {
  promptKey: "writing.selection_rewrite",
  promptVersion: 1,
  promptHash: "a".repeat(64),
  provider: "deepseek",
  model: "deepseek-chat",
  parameters: { maxTokens: 2_000 },
};

const budget = {
  maxCostCny: 1.5,
  maxTokens: 12_000,
  maxRevisionRounds: 0,
};

describe("writing action contracts", () => {
  it("accepts one independent discriminated input for every writing action", () => {
    const requests = [
      { action: "continue", sourceVersionId: VERSION_ID, targetLength: 600, budget },
      { action: "rewrite", sourceVersionId: VERSION_ID, instruction: "收紧动作描写", budget },
      { action: "expand", sourceVersionId: VERSION_ID, targetLength: 900, budget },
      { action: "condense", sourceVersionId: VERSION_ID, targetLength: 300, budget },
      { action: "change_pov", sourceVersionId: VERSION_ID, pov: "顾青", budget },
      { action: "add_hook", sourceVersionId: VERSION_ID, hookStyle: "reversal", budget },
      { action: "generate_title", sourceVersionId: VERSION_ID, count: 3, budget },
      { action: "generate_summary", sourceVersionId: VERSION_ID, maxLength: 160, budget },
      {
        action: "selection_rewrite",
        sourceVersionId: VERSION_ID,
        selection: { start: 6, end: 12 },
        instruction: "保留原意，只增强紧张感",
        budget,
      },
    ] as const;

    expect(requests.map((request) => writingActionRequestSchema.parse(request).action)).toEqual([
      "continue",
      "rewrite",
      "expand",
      "condense",
      "change_pov",
      "add_hook",
      "generate_title",
      "generate_summary",
      "selection_rewrite",
    ]);
  });

  it("rejects cross-action fields, empty selections and unknown properties", () => {
    expect(() =>
      writingActionRequestSchema.parse({
        action: "change_pov",
        sourceVersionId: VERSION_ID,
        pov: "顾青",
        instruction: "不属于改视角",
        budget,
      }),
    ).toThrow();
    expect(() =>
      writingActionRequestSchema.parse({
        action: "selection_rewrite",
        sourceVersionId: VERSION_ID,
        selection: { start: 6, end: 6 },
        instruction: "重写",
        budget,
      }),
    ).toThrow();
    expect(() =>
      writingActionRequestSchema.parse({
        action: "rewrite",
        sourceVersionId: VERSION_ID,
        instruction: "重写",
        budget,
        unexpected: true,
      }),
    ).toThrow();
  });

  it("versions chapter text and non-text artifacts through the same output envelope", () => {
    const chapterOutput = writingActionOutputSchema.parse({
      id: OUTPUT_ID,
      action: "selection_rewrite",
      version: 4,
      versionNodeId: NODE_ID,
      sourceVersionId: VERSION_ID,
      chapterVersionId: VERSION_ID,
      affectedRange: { originalStart: 6, originalEnd: 12, start: 6, end: 12 },
      provenance,
      kind: "chapter_text",
      content: "alpha\n\nbeta\n\nomega",
      createdAt: "2026-11-06T10:00:00.000Z",
    });
    expect(chapterOutput).toMatchObject({
      action: "selection_rewrite",
      kind: "chapter_text",
      affectedRange: { originalStart: 6, originalEnd: 12, start: 6, end: 12 },
    });

    const titleOutput = writingActionOutputSchema.parse({
      id: OUTPUT_ID,
      action: "generate_title",
      version: 1,
      versionNodeId: NODE_ID,
      sourceVersionId: VERSION_ID,
      chapterVersionId: null,
      affectedRange: null,
      provenance: { ...provenance, promptKey: "writing.generate_title" },
      kind: "title_options",
      titles: ["断臂之后", "一只手也能结印", "忘川初现"],
      createdAt: "2026-11-06T10:00:00.000Z",
    });
    expect(titleOutput.kind).toBe("title_options");
    expect(() =>
      writingActionOutputSchema.parse({
        ...titleOutput,
        titles: [],
      }),
    ).toThrow();
    expect(() =>
      writingActionOutputSchema.parse({
        ...chapterOutput,
        affectedRange: null,
      }),
    ).toThrow();
    expect(() =>
      writingActionOutputSchema.parse({
        ...titleOutput,
        chapterVersionId: VERSION_ID,
      }),
    ).toThrow();
  });

  it("ships the writing action as a typed worker job", () => {
    const job = workerJobSchema.parse({
      jobId: JOB_ID,
      jobType: WRITE_ACTION_JOB,
      workId: WORK_ID,
      branchId: BRANCH_ID,
      chapterId: CHAPTER_ID,
      actorId: ACTOR_ID,
      modelConfigId: MODEL_CONFIG_ID,
      idempotencyKey: "write-action-once",
      action: "rewrite",
      sourceVersionId: VERSION_ID,
      input: {
        action: "rewrite",
        sourceVersionId: VERSION_ID,
        instruction: "收紧动作描写",
        budget,
      },
      budget,
      checkpoint: {
        schemaVersion: 1,
        revision: 0,
        step: "prepare",
        inputHash: null,
        outputRefs: [],
        payload: {},
      },
    });
    expect(job).toMatchObject({
      jobType: "write_action",
      action: "rewrite",
      sourceVersionId: VERSION_ID,
    });
    expect(() =>
      workerJobSchema.parse({
        ...job,
        action: "condense",
      }),
    ).toThrow();
  });
});
