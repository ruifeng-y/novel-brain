import { describe, expect, it } from "vitest";

import {
  compileContextManifest,
  ContextBudgetExceededError,
  ContextWindowTooSmallError,
  type ContextCandidate,
  type CompileContextManifestInput,
} from "../src";

const mainBranchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c01";
const otherBranchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c02";
const chapterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c03";
const factId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c04";
const shenId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c05";

describe("M1 context manifest compiler", () => {
  it("keeps every P0 candidate when lower layers overflow", () => {
    const manifest = compileContextManifest(
      input({
        requestedTokenBudget: 11,
        candidates: [
          candidate({ key: "p0:world-rule", layer: "P0", content: "断臂不可双手结印" }),
          candidate({ key: "p2:recent", layer: "P2", content: "上一章追兵逼近荒寺" }),
          candidate({ key: "p3:style", layer: "P3", content: "短句白描" }),
          candidate({ key: "p4:reference", layer: "P4", content: "可选参考资料" }),
        ],
      }),
    );

    expect(manifest.selected.map((entry) => entry.key)).toContain("p0:world-rule");
    expect(manifest.evicted.map((entry) => entry.key)).toEqual(["p4:reference"]);
    expect(manifest.budget.layers.P4).toMatchObject({
      selectedCount: 0,
      evictedCount: 1,
    });
    expect(manifest.budget.layers.P0.selectedCount).toBe(1);
  });

  it("never selects cross-branch, future, expired or POV-unknown candidates", () => {
    const manifest = compileContextManifest(
      input({
        candidates: [
          candidate({ key: "p1:known", layer: "P1", knowledgeFactId: factId }),
          candidate({ key: "p1:other-branch", layer: "P1", branchId: otherBranchId }),
          candidate({
            key: "p1:future",
            layer: "P1",
            validity: { fromChapter: 6, toChapter: null },
          }),
          candidate({
            key: "p1:expired",
            layer: "P1",
            validity: { fromChapter: 1, toChapter: 4 },
          }),
          candidate({ key: "p1:unknown", layer: "P1", knowledgeFactId: "unknown-fact" }),
        ],
        knowledge: {
          facts: [
            {
              id: factId,
              subject: "沈砚",
              predicate: "身体状态",
              object: "左臂骨折",
              validFromChapter: 1,
              validToChapter: null,
            },
          ],
          states: [
            {
              objectiveFactId: factId,
              state: "knowledge",
              claimedContent: "沈砚知道自己左臂骨折。",
              validFromChapter: 2,
              validToChapter: null,
            },
          ],
        },
      }),
    );

    expect(manifest.selected.map((entry) => entry.key)).toEqual(["p1:known"]);
    expect(manifest.evicted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "p1:other-branch", reason: "stale_branch" }),
        expect.objectContaining({ key: "p1:future", reason: "future_fact" }),
        expect.objectContaining({ key: "p1:expired", reason: "expired_fact" }),
        expect.objectContaining({ key: "p1:unknown", reason: "knowledge_boundary" }),
      ]),
    );
    expect(manifest.selected.map((entry) => entry.key)).not.toContain("p1:unknown");
  });

  it("applies story-time validity windows when the era is comparable", () => {
    const manifest = compileContextManifest(
      input({
        storyTime: { era: "大玄历", label: "第一年夏", sortKey: 20 },
        candidates: [
          candidate({
            key: "p1:before",
            layer: "P1",
            validity: {
              fromStoryTime: { era: "大玄历", label: "第一年秋", sortKey: 30 },
            },
          }),
          candidate({
            key: "p1:after",
            layer: "P1",
            validity: {
              fromStoryTime: { era: "大玄历", label: "第一年春", sortKey: 10 },
              toStoryTime: { era: "大玄历", label: "第一年春末", sortKey: 15 },
            },
          }),
          candidate({
            key: "p1:inside",
            layer: "P1",
            validity: {
              fromStoryTime: { era: "大玄历", label: "第一年春", sortKey: 10 },
              toStoryTime: { era: "大玄历", label: "第一年秋", sortKey: 30 },
            },
          }),
        ],
      }),
    );

    expect(manifest.selected.map((entry) => entry.key)).toEqual(["p1:inside"]);
    expect(manifest.evicted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "p1:before", reason: "time_window" }),
        expect.objectContaining({ key: "p1:after", reason: "time_window" }),
      ]),
    );
  });

  it("selects candidates by task and POV scope", () => {
    const manifest = compileContextManifest(
      input({
        task: "chapter_draft",
        candidates: [
          candidate({ key: "p1:all-tasks", layer: "P1" }),
          candidate({
            key: "p1:revision-only",
            layer: "P1",
            tasks: ["chapter_revision"],
          }),
          candidate({
            key: "p1:other-pov",
            layer: "P1",
            povCharacterIds: ["0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c77"],
          }),
        ],
      }),
    );

    expect(manifest.selected.map((entry) => entry.key)).toEqual(["p1:all-tasks"]);
    expect(manifest.evicted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "p1:revision-only", reason: "task_mismatch" }),
        expect.objectContaining({ key: "p1:other-pov", reason: "pov_mismatch" }),
      ]),
    );
  });

  it("blocks deterministically when P0 exceeds the effective model window", () => {
    const attempt = () =>
      compileContextManifest(
        input({
          requestedTokenBudget: 100,
          modelContextWindowTokens: 6,
          reservedOutputTokens: 1,
          candidates: [
            candidate({ key: "p0:a", layer: "P0", content: "硬约束甲乙丙" }),
            candidate({ key: "p0:b", layer: "P0", content: "硬约束丁戊己" }),
          ],
        }),
      );

    expect(attempt).toThrow(ContextBudgetExceededError);
    try {
      attempt();
    } catch (error) {
      expect(error).toMatchObject({
        requiredTokens: 6,
        tokenBudget: 5,
      });
    }
  });

  it("rejects a model window that only leaves room for output", () => {
    expect(() =>
      compileContextManifest(
        input({
          modelContextWindowTokens: 4,
          reservedOutputTokens: 4,
        }),
      ),
    ).toThrow(ContextWindowTooSmallError);
  });

  it("produces the same manifest for identical inputs regardless of candidate order", () => {
    const candidates = [
      candidate({ key: "p0:a", layer: "P0", content: "硬约束甲" }),
      candidate({ key: "p1:b", layer: "P1", content: "场景事实乙", order: 1 }),
      candidate({ key: "p1:c", layer: "P1", content: "场景事实丙", order: 2 }),
      candidate({ key: "p2:d", layer: "P2", content: "近章叙事丁", order: 1 }),
      candidate({ key: "p3:e", layer: "P3", content: "文风戊", order: 1 }),
    ];
    const first = compileContextManifest(input({ requestedTokenBudget: 12, candidates }));
    const second = compileContextManifest(
      input({ requestedTokenBudget: 12, candidates: [...candidates].reverse() }),
    );

    expect(second).toEqual(first);
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(first.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("property: P0 is never evicted and lower layers are evicted from P4 upward", () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const generated = generatedCandidates(seed);
      const requestedTokenBudget = 8 + (seed % 20);
      const manifest = compileContextManifest(
        input({ requestedTokenBudget, candidates: generated }),
      );
      const p0Keys = generated.filter((entry) => entry.layer === "P0").map((entry) => entry.key);
      const selectedKeys = manifest.selected.map((entry) => entry.key);

      expect(p0Keys.every((key) => selectedKeys.includes(key))).toBe(true);
      expect(manifest.tokenUsed).toBeLessThanOrEqual(manifest.tokenBudget);
      const evictedLayers = new Set(manifest.evicted.map((entry) => entry.layer));
      if (evictedLayers.has("P3")) {
        expect(evictedLayers.has("P4")).toBe(true);
      }
      if (evictedLayers.has("P2")) {
        expect(evictedLayers.has("P4") && evictedLayers.has("P3")).toBe(true);
      }
    }
  });

  it("property: shuffled candidates never leak branch, future or unknown facts", () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const generated = generatedLeakCandidates(seed);
      const manifest = compileContextManifest(
        input({
          requestedTokenBudget: 200,
          candidates: [...generated].sort(
            (left, right) => hash(left.key, seed) - hash(right.key, seed),
          ),
          knowledge: {
            facts: [
              {
                id: factId,
                subject: "沈砚",
                predicate: "身体状态",
                object: "左臂骨折",
                validFromChapter: 1,
                validToChapter: null,
              },
            ],
            states: [
              {
                objectiveFactId: factId,
                state: "knowledge",
                claimedContent: "沈砚知道自己左臂骨折。",
                validFromChapter: 2,
                validToChapter: null,
              },
            ],
          },
        }),
      );
      for (const entry of manifest.selected) {
        expect(entry.branchId).not.toBe(otherBranchId);
        expect(entry.key).not.toMatch(/future|expired|unknown/);
      }
    }
  });
});

function input(overrides: Partial<CompileContextManifestInput> = {}): CompileContextManifestInput {
  return {
    compilerVersion: "m1-context-v1",
    task: "chapter_draft",
    chapterId,
    chapterNumber: 5,
    povCharacterId: shenId,
    branchId: mainBranchId,
    branchStatus: "active",
    storyTime: { era: "大玄历", label: "第一年夏", sortKey: 20 },
    requestedTokenBudget: 200,
    modelContextWindowTokens: 1_000,
    reservedOutputTokens: 100,
    candidates: [],
    knowledge: { facts: [], states: [] },
    ...overrides,
  };
}

function candidate(
  overrides: Partial<ContextCandidate> & Pick<ContextCandidate, "key" | "layer" | "content">,
): ContextCandidate {
  return {
    content: overrides.key,
    label: overrides.key,
    branchId: mainBranchId,
    order: 0,
    sourceRefs: [
      {
        sourceType: "setting",
        sourceId: factId,
        label: overrides.key,
        citation: overrides.key,
      },
    ],
    ...overrides,
  };
}

function generatedCandidates(seed: number): ContextCandidate[] {
  return ["P0", "P0", "P1", "P2", "P3", "P4"].map((layer, index) =>
    candidate({
      key: `${layer}:${seed}:${index}`,
      layer: layer as ContextCandidate["layer"],
      content: `${layer}内容${seed}${index}`,
      order: index,
    }),
  );
}

function generatedLeakCandidates(seed: number): ContextCandidate[] {
  return [
    candidate({
      key: `p1:known:${seed}`,
      layer: "P1",
      content: `已知事实${seed}`,
      knowledgeFactId: factId,
    }),
    candidate({
      key: `p1:other-branch:${seed}`,
      layer: "P1",
      content: `跨分支${seed}`,
      branchId: otherBranchId,
    }),
    candidate({
      key: `p1:future:${seed}`,
      layer: "P1",
      content: `未来${seed}`,
      validity: { fromChapter: 6 + seed, toChapter: null },
    }),
    candidate({
      key: `p1:expired:${seed}`,
      layer: "P1",
      content: `过期${seed}`,
      validity: { fromChapter: 1, toChapter: 4 },
    }),
    candidate({
      key: `p1:unknown:${seed}`,
      layer: "P1",
      content: `未知${seed}`,
      knowledgeFactId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c99",
    }),
  ];
}

function hash(value: string, seed: number): number {
  let result = seed;
  for (const character of value) {
    result = (result * 31 + character.charCodeAt(0)) % 1_000_003;
  }
  return result;
}
