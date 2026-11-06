import { describe, expect, it } from "vitest";

import {
  REVISION_MAX_ROUNDS,
  revisionFeedbackCreateRequestSchema,
  revisionPlanCreateRequestSchema,
  revisionPlanWorkspaceSchema,
  targetedRevisionWritingActionSchema,
  writingActionOutputSchema,
} from "../src";

const workId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b01";
const branchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b02";
const chapterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b03";
const sourceVersionId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b04";
const resultVersionId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b05";
const findingId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b06";
const planId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b07";
const roundId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b08";
const jobId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b09";
const outputId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b0a";
const nodeId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b0b";
const feedbackId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b0c";
const actorId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2b0d";

const evidence = {
  kind: "text",
  sourceId: null,
  sourceVersionId,
  chapterId,
  chapterVersionId: sourceVersionId,
  quote: "太震撼了！！！",
  startOffset: 8,
  endOffset: 14,
  locator: "第 1 章 · 第 2 段",
  explanation: "连续感叹号与既定声线不一致。",
};

const selectedFinding = {
  findingId,
  code: "STYLE_DRIFT",
  severity: "P2",
  qualityDimension: "character_voice",
  recommendation: "删去连续感叹号，改成克制的动作反应。",
  evidence: [evidence],
};

const blocks = [
  { id: "block-1", start: 8, end: 14, label: "第二段情绪反应" },
  { id: "block-2", start: 20, end: 26, label: "第三段收束" },
];

const request = {
  sourceVersionId,
  findingIds: [findingId],
  blocks,
  constraints: {
    preserveOutsideSelection: true,
    protectLockedContent: true,
    authorInstruction: "保持人物克制，不要新增事实。",
  },
};

describe("targeted revision contracts", () => {
  it("freezes the default two-round budget and validates selected text blocks", () => {
    expect(REVISION_MAX_ROUNDS).toBe(2);
    const parsed = revisionPlanCreateRequestSchema.parse(request);
    expect(parsed.budget).toEqual({
      maxCostCny: 2.5,
      maxTokens: 30_000,
      maxRevisionRounds: 2,
    });
    expect(parsed.constraints).toEqual(request.constraints);

    expect(() =>
      revisionPlanCreateRequestSchema.parse({
        ...request,
        blocks: [
          { id: "block-1", start: 8, end: 20 },
          { id: "block-2", start: 14, end: 26 },
        ],
      }),
    ).toThrow();
    expect(() =>
      revisionPlanCreateRequestSchema.parse({
        ...request,
        budget: {
          maxCostCny: 2.5,
          maxTokens: 30_000,
          maxRevisionRounds: 3,
        },
      }),
    ).toThrow();
  });

  it("uses the writing action envelope without allowing an affected single range", () => {
    const action = targetedRevisionWritingActionSchema.parse({
      action: "targeted_revision",
      ...request,
    });
    expect(action).toMatchObject({
      action: "targeted_revision",
      findingIds: [findingId],
      budget: { maxRevisionRounds: 2 },
    });
    expect(() =>
      targetedRevisionWritingActionSchema.parse({
        action: "targeted_revision",
        ...request,
        unexpected: true,
      }),
    ).toThrow();

    const output = writingActionOutputSchema.parse({
      id: outputId,
      action: "targeted_revision",
      version: 3,
      versionNodeId: nodeId,
      sourceVersionId,
      chapterVersionId: resultVersionId,
      affectedRange: null,
      provenance: {
        promptKey: "writing.targeted_revision",
        promptVersion: 1,
        promptHash: "a".repeat(64),
        provider: "deepseek",
        model: "deepseek-chat",
        parameters: {},
      },
      kind: "chapter_text",
      content: "太安静了。",
      createdAt: "2026-11-06T10:00:00.000Z",
    });
    expect(output).toMatchObject({
      action: "targeted_revision",
      affectedRange: null,
      kind: "chapter_text",
    });
  });

  it("records a round diff, unresolved findings and explicit evaluation opt-in", () => {
    const workspace = revisionPlanWorkspaceSchema.parse({
      plan: {
        id: planId,
        workId,
        branchId,
        chapterId,
        sourceVersionId,
        status: "awaiting_feedback",
        maxRounds: 2,
        budget: {
          maxCostCny: 2.5,
          maxTokens: 30_000,
          maxRevisionRounds: 2,
        },
        version: 1,
        createdAt: "2026-11-06T10:00:00.000Z",
        updatedAt: "2026-11-06T10:01:00.000Z",
        completedAt: null,
      },
      rounds: [
        {
          id: roundId,
          planId,
          workId,
          branchId,
          chapterId,
          roundNumber: 1,
          status: "waiting_review",
          jobId,
          jobStatus: "waiting_review",
          sourceVersionId,
          resultVersionId,
          versionNodeId: nodeId,
          selectedFindings: [selectedFinding],
          blocks,
          constraints: request.constraints,
          diff: {
            sourceVersionId,
            resultVersionId,
            beforeHash: "b".repeat(64),
            afterHash: "c".repeat(64),
            changes: [
              {
                blockId: "block-1",
                beforeStart: 8,
                beforeEnd: 14,
                afterStart: 8,
                afterEnd: 13,
                before: "太震撼了！！！",
                after: "太安静了。",
              },
            ],
            unresolvedFindingIds: [findingId],
          },
          unresolvedFindingIds: [findingId],
          version: 1,
          createdAt: "2026-11-06T10:00:00.000Z",
          updatedAt: "2026-11-06T10:01:00.000Z",
          finishedAt: "2026-11-06T10:01:00.000Z",
        },
      ],
      feedback: [
        {
          id: feedbackId,
          planId,
          roundId,
          workId,
          branchId,
          chapterId,
          findingId,
          action: "reject",
          reason: "这个建议会破坏人物当时的失控状态。",
          targetVersionId: resultVersionId,
          evaluationOptIn: false,
          actorId,
          createdAt: "2026-11-06T10:02:00.000Z",
        },
      ],
      evaluationFeedback: [],
    });
    expect(workspace.rounds[0]?.unresolvedFindingIds).toEqual([findingId]);
    expect(workspace.feedback[0]?.evaluationOptIn).toBe(false);
    expect(workspace.evaluationFeedback).toEqual([]);

    expect(
      revisionFeedbackCreateRequestSchema.parse({
        action: "reject",
        reason: "不接受这个改法",
        version: 1,
        findingId,
      }),
    ).toMatchObject({ action: "reject", evaluationOptIn: false });
    expect(() =>
      revisionFeedbackCreateRequestSchema.parse({
        action: "reject",
        version: 1,
      }),
    ).toThrow();
  });
});
