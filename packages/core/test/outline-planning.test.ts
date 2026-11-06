import { describe, expect, it } from "vitest";

import {
  computeOutlineImpact,
  evaluateOutlineReadiness,
  OUTLINE_READINESS_RULE_VERSION,
  validateOutlineStructure,
  type OutlineStructureNode,
} from "../src";

function node(
  id: string,
  level: OutlineStructureNode["level"],
  parentId: string | null,
  sortOrder: number,
  extra: Partial<OutlineStructureNode> = {},
): OutlineStructureNode {
  return {
    id,
    level,
    parentId,
    sortOrder,
    workId: "work-1",
    branchId: "branch-1",
    locked: false,
    ...extra,
  };
}

function validTree(): OutlineStructureNode[] {
  return [
    node("book", "book", null, 0),
    node("volume", "volume", "book", 0),
    node("act", "act", "volume", 0),
    node("chapter", "chapter", "act", 0, { chapterId: "chapter-1" }),
    node("scene", "scene", "chapter", 0),
  ];
}

describe("outline structure constraints", () => {
  it("accepts the five-level book/volume/act/chapter/scene chain", () => {
    expect(validateOutlineStructure(validTree())).toEqual([]);
  });

  it("rejects invalid parent levels and chapter links", () => {
    const issues = validateOutlineStructure([
      node("book", "book", null, 0),
      node("volume", "volume", "book", 0),
      node("bad-act", "act", "book", 0),
      node("bad-chapter", "chapter", "volume", 1),
      node("bad-scene", "scene", "act", 0),
      node("chapter-without-link", "chapter", "book", 2),
    ]);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["OUTLINE_PARENT_LEVEL_INVALID", "OUTLINE_CHAPTER_LINK_INVALID"]),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OUTLINE_PARENT_LEVEL_INVALID",
          nodeId: "bad-act",
          parentId: "book",
        }),
        expect.objectContaining({
          code: "OUTLINE_CHAPTER_LINK_INVALID",
          nodeId: "chapter-without-link",
        }),
      ]),
    );
  });

  it("rejects cycles, duplicate sibling order and cross-branch parents", () => {
    const issues = validateOutlineStructure([
      node("book", "book", null, 0),
      node("volume-a", "volume", "book", 0),
      node("volume-b", "volume", "book", 0),
      node("act-a", "act", "cycle-volume", 0),
      node("cycle-volume", "volume", "act-a", 1),
      node("cross-branch", "volume", "book", 2, { branchId: "branch-2" }),
      node("act-b", "act", "volume-b", 0),
    ]);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "OUTLINE_DUPLICATE_ORDER",
        "OUTLINE_CYCLE",
        "OUTLINE_PARENT_BRANCH_MISMATCH",
      ]),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OUTLINE_CYCLE", nodeId: "cycle-volume" }),
        expect.objectContaining({
          code: "OUTLINE_PARENT_BRANCH_MISMATCH",
          nodeId: "cross-branch",
        }),
      ]),
    );
  });

  it("requires exactly one book root and one outline node per chapter", () => {
    const issues = validateOutlineStructure([
      node("book-a", "book", null, 0),
      node("book-b", "book", null, 1),
      node("volume", "volume", "book-a", 0),
      node("act", "act", "volume", 0),
      node("chapter-a", "chapter", "act", 0, { chapterId: "chapter-1" }),
      node("chapter-b", "chapter", "act", 1, { chapterId: "chapter-1" }),
    ]);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["OUTLINE_ROOT_DUPLICATE", "OUTLINE_CHAPTER_DUPLICATE"]),
    );
  });
});

describe("outline re-planning impact", () => {
  it("collects descendants, linked chapters and scene nodes for a changed subtree", () => {
    const impact = computeOutlineImpact(
      [
        ...validTree(),
        node("chapter-b", "chapter", "act", 1, { chapterId: "chapter-2", locked: true }),
        node("scene-b", "scene", "chapter-b", 0),
        node("other-volume", "volume", "book", 1),
      ],
      "act",
    );

    expect(impact).toEqual({
      nodeId: "act",
      affectedNodeIds: ["act", "chapter", "chapter-b", "scene", "scene-b"],
      chapterIds: ["chapter-1", "chapter-2"],
      sceneNodeIds: ["scene", "scene-b"],
      lockedNodeIds: ["chapter-b"],
    });
  });
});

describe("outline readiness", () => {
  it("returns stable rule version and blocks on missing structure, contracts, briefs and scenes", () => {
    const readiness = evaluateOutlineReadiness({
      nodes: validTree(),
      volumeContractNodeIds: [],
      chapterBriefReadyIds: [],
      sceneCards: [
        {
          nodeId: "scene",
          povReady: false,
          locationReady: true,
          storyTimeReady: false,
          beatCount: 0,
          informationReleaseCount: 0,
        },
      ],
    });

    expect(readiness.ruleVersion).toBe(OUTLINE_READINESS_RULE_VERSION);
    expect(readiness.status).toBe("not_ready");
    expect(readiness.canProceed).toBe(false);
    expect(readiness.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "volume_contract:volume",
          severity: "blocker",
          ready: false,
          resourceType: "outline_node",
          resourceId: "volume",
        }),
        expect.objectContaining({
          key: "chapter_brief:chapter",
          severity: "blocker",
          ready: false,
          resourceId: "chapter",
        }),
        expect.objectContaining({
          key: "scene_pov:scene",
          severity: "blocker",
          ready: false,
        }),
        expect.objectContaining({
          key: "scene_beats:scene",
          severity: "blocker",
          ready: false,
        }),
        expect.objectContaining({
          key: "scene_time:scene",
          severity: "warning",
          ready: false,
        }),
        expect.objectContaining({
          key: "scene_information:scene",
          severity: "warning",
          ready: false,
        }),
      ]),
    );
    expect(readiness.items.some((item) => item.severity === "blocker" && !item.ready)).toBe(true);
  });

  it("is ready only when blockers and warnings are both clear", () => {
    const ready = evaluateOutlineReadiness({
      nodes: validTree(),
      volumeContractNodeIds: ["volume"],
      chapterBriefReadyIds: ["chapter"],
      sceneCards: [
        {
          nodeId: "scene",
          povReady: true,
          locationReady: true,
          storyTimeReady: true,
          beatCount: 3,
          informationReleaseCount: 1,
        },
      ],
    });

    expect(ready).toMatchObject({
      ruleVersion: OUTLINE_READINESS_RULE_VERSION,
      status: "ready",
      canProceed: true,
      completed: ready.total,
      total: ready.items.length,
    });
    expect(ready.items.every((item) => item.ready)).toBe(true);
  });

  it("reports partial readiness when only warnings remain", () => {
    const partial = evaluateOutlineReadiness({
      nodes: validTree(),
      volumeContractNodeIds: ["volume"],
      chapterBriefReadyIds: ["chapter"],
      sceneCards: [
        {
          nodeId: "scene",
          povReady: true,
          locationReady: true,
          storyTimeReady: true,
          beatCount: 2,
          informationReleaseCount: 0,
        },
      ],
    });

    expect(partial.status).toBe("partial");
    expect(partial.canProceed).toBe(true);
    expect(partial.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "scene_information:scene",
          severity: "warning",
          ready: false,
        }),
      ]),
    );
  });
});
