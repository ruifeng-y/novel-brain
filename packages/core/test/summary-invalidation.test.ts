import { describe, expect, it } from "vitest";

import { computeSummaryInvalidation, type SummaryOutlineNode } from "../src";

const nodes: SummaryOutlineNode[] = [
  node("book", "book", null),
  node("volume-1", "volume", "book"),
  node("act-1", "act", "volume-1"),
  node("chapter-1", "chapter", "act-1", "chapter-1-record"),
  node("chapter-2", "chapter", "act-1", "chapter-2-record"),
  node("act-2", "act", "volume-1"),
  node("chapter-3", "chapter", "act-2", "chapter-3-record"),
  node("volume-2", "volume", "book"),
  node("act-3", "act", "volume-2"),
  node("chapter-4", "chapter", "act-3", "chapter-4-record"),
  node("other-branch-book", "book", null, null, "branch-2"),
];

describe("summary invalidation dependency rule", () => {
  it("invalidates a changed chapter and only its ancestor summaries", () => {
    const result = computeSummaryInvalidation(nodes, {
      kind: "chapter",
      branchId: "branch-1",
      chapterId: "chapter-1-record",
    });

    expect(result.branchId).toBe("branch-1");
    expect(new Set(result.scopeIds)).toEqual(new Set(["chapter-1", "act-1", "volume-1", "book"]));
    expect(result.scopeIds).not.toContain("chapter-2");
    expect(result.scopeIds).not.toContain("volume-2");
  });

  it("invalidates a changed outline subtree and its ancestors without touching siblings", () => {
    const result = computeSummaryInvalidation(nodes, {
      kind: "outline_node",
      branchId: "branch-1",
      nodeId: "act-1",
    });

    expect(new Set(result.scopeIds)).toEqual(
      new Set(["act-1", "chapter-1", "chapter-2", "volume-1", "book"]),
    );
    expect(result.scopeIds).not.toContain("act-2");
    expect(result.scopeIds).not.toContain("chapter-3");
    expect(result.scopeIds).not.toContain("volume-2");
  });

  it("keeps branch invalidation inside the changed branch", () => {
    const result = computeSummaryInvalidation(nodes, {
      kind: "branch",
      branchId: "branch-2",
    });

    expect(result.scopeIds).toEqual(["other-branch-book"]);
  });
});

function node(
  id: string,
  level: SummaryOutlineNode["level"],
  parentId: string | null,
  chapterId: string | null = null,
  branchId = "branch-1",
): SummaryOutlineNode {
  return { id, branchId, level, parentId, chapterId };
}
