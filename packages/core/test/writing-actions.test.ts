import { describe, expect, it } from "vitest";

import { WRITING_ACTION_SPECS, compileWritingActionPrompt, spliceSelectedText } from "../src";

describe("writing action rules", () => {
  it("replaces only the selected text and reports the exact source range", () => {
    const source = "alpha\n\nBETA\n\nomega";
    const result = spliceSelectedText(source, { start: 7, end: 11 }, "beta");

    expect(result).toEqual({
      content: "alpha\n\nbeta\n\nomega",
      affectedRange: {
        originalStart: 7,
        originalEnd: 11,
        start: 7,
        end: 11,
      },
    });
    expect(result.content.slice(0, result.affectedRange.start)).toBe("alpha\n\n");
    expect(result.content.slice(result.affectedRange.end)).toBe("\n\nomega");
  });

  it("rejects empty, reversed, and out-of-bounds selection ranges", () => {
    expect(() => spliceSelectedText("alpha", { start: 2, end: 2 }, "beta")).toThrow(
      "Selection must not be empty",
    );
    expect(() => spliceSelectedText("alpha", { start: 4, end: 2 }, "beta")).toThrow(
      "Selection end must be after start",
    );
    expect(() => spliceSelectedText("alpha", { start: 1, end: 9 }, "beta")).toThrow(
      "Selection is outside the source version",
    );
  });

  it("publishes isolated prompt, permission and output metadata for every action", () => {
    expect(WRITING_ACTION_SPECS).toEqual({
      continue: {
        promptKey: "writing.continue",
        promptVersion: 1,
        role: "writer",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "chapter_text",
        chapterVersion: true,
      },
      rewrite: {
        promptKey: "writing.rewrite",
        promptVersion: 1,
        role: "reviser",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "chapter_text",
        chapterVersion: true,
      },
      expand: {
        promptKey: "writing.expand",
        promptVersion: 1,
        role: "reviser",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "chapter_text",
        chapterVersion: true,
      },
      condense: {
        promptKey: "writing.condense",
        promptVersion: 1,
        role: "reviser",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "chapter_text",
        chapterVersion: true,
      },
      change_pov: {
        promptKey: "writing.change_pov",
        promptVersion: 1,
        role: "reviser",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "chapter_text",
        chapterVersion: true,
      },
      add_hook: {
        promptKey: "writing.add_hook",
        promptVersion: 1,
        role: "reviser",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "hooks",
        chapterVersion: false,
      },
      generate_title: {
        promptKey: "writing.generate_title",
        promptVersion: 1,
        role: "writer",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "title_options",
        chapterVersion: false,
      },
      generate_summary: {
        promptKey: "writing.generate_summary",
        promptVersion: 1,
        role: "writer",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "summary",
        chapterVersion: false,
      },
      selection_rewrite: {
        promptKey: "writing.selection_rewrite",
        promptVersion: 1,
        role: "reviser",
        toolName: "draft.write_version",
        permission: "chapter.write",
        outputKind: "chapter_text",
        chapterVersion: true,
      },
    });
  });

  it("builds author-controlled prompts without changing non-selected text", () => {
    const prompt = compileWritingActionPrompt({
      action: "selection_rewrite",
      sourceContent: "alpha\n\nBETA\n\nomega",
      instruction: "只增强紧张感",
      selection: { start: 7, end: 11 },
      sourceRefs: ["第 1 章 · 一只手也能结印"],
    });

    expect(prompt.system).toContain("只输出改写后的选中文本");
    expect(prompt.prompt).toContain("只增强紧张感");
    expect(prompt.prompt).toContain("BETA");
    expect(prompt.prompt).not.toContain("alpha");
    expect(prompt.prompt).not.toContain("omega");
  });
});
