import type {
  WritingActionKind,
  WritingActionSelection,
  WritingActionAffectedRange,
} from "@novel-brain/contracts";

import { compileTargetedRevisionPrompt, type TargetedRevisionPromptInput } from "./revision";

export interface WritingActionSpec {
  promptKey: string;
  promptVersion: 1;
  role: "writer" | "reviser";
  toolName: "draft.write_version";
  permission: "chapter.write";
  outputKind: "chapter_text" | "title_options" | "summary" | "hooks";
  chapterVersion: boolean;
}

export const WRITING_ACTION_SPECS = {
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
  targeted_revision: {
    promptKey: "writing.targeted_revision",
    promptVersion: 1,
    role: "reviser",
    toolName: "draft.write_version",
    permission: "chapter.write",
    outputKind: "chapter_text",
    chapterVersion: true,
  },
} as const satisfies Record<WritingActionKind, WritingActionSpec>;

export class WritingActionSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WritingActionSelectionError";
  }
}

export interface SplicedWritingAction {
  content: string;
  affectedRange: WritingActionAffectedRange;
}

export function spliceSelectedText(
  sourceContent: string,
  selection: WritingActionSelection,
  replacement: string,
): SplicedWritingAction {
  if (selection.start === selection.end) {
    throw new WritingActionSelectionError("Selection must not be empty");
  }
  if (selection.end < selection.start) {
    throw new WritingActionSelectionError("Selection end must be after start");
  }
  if (selection.end > sourceContent.length) {
    throw new WritingActionSelectionError("Selection is outside the source version");
  }
  if (!replacement.trim()) {
    throw new WritingActionSelectionError("Selected rewrite must not be empty");
  }
  return {
    content:
      sourceContent.slice(0, selection.start) + replacement + sourceContent.slice(selection.end),
    affectedRange: {
      originalStart: selection.start,
      originalEnd: selection.end,
      start: selection.start,
      end: selection.start + replacement.length,
    },
  };
}

export interface WritingActionPromptInput {
  action: WritingActionKind;
  sourceContent: string;
  sourceRefs: string[];
  instruction?: string;
  selection?: WritingActionSelection;
  targetLength?: number;
  pov?: string;
  hookStyle?: string;
  maxLength?: number;
  revision?: TargetedRevisionPromptInput;
}

export interface WritingActionPrompt {
  system: string;
  prompt: string;
}

export function compileWritingActionPrompt(input: WritingActionPromptInput): WritingActionPrompt {
  if (input.action === "targeted_revision") {
    if (!input.revision) {
      throw new WritingActionSelectionError("Targeted revision requires selected blocks");
    }
    return compileTargetedRevisionPrompt(input.revision);
  }
  const selected =
    input.selection === undefined
      ? input.sourceContent
      : input.sourceContent.slice(input.selection.start, input.selection.end);
  const references =
    input.sourceRefs.length > 0
      ? ["来源引用：", ...input.sourceRefs.map((reference) => `- ${reference}`)].join("\n")
      : "";
  const authorInstruction = input.instruction ? `作者要求：${input.instruction}` : "";

  const instructionByAction: Record<WritingActionKind, string> = {
    continue: `从正文末尾继续写${input.targetLength ? `约 ${input.targetLength} 字` : ""}，只输出新增正文。`,
    rewrite: "改写以下正文，保留事实和章纲约束，只输出改写后的完整正文。",
    expand: `扩写以下正文，目标约 ${input.targetLength ?? 1_000} 字，只输出扩写后的完整正文。`,
    condense: `缩写以下正文，目标约 ${input.targetLength ?? 500} 字，只输出缩写后的完整正文。`,
    change_pov: `把以下正文改为以${input.pov ?? "新视角人物"}为视角，只输出改写后的完整正文。`,
    add_hook: `为正文生成最多三个${hookStyleLabel(input.hookStyle)}候选，每行一个，只输出候选。`,
    generate_title: "根据正文生成最多三个章节标题，每行一个，不要编号或解释。",
    generate_summary: `根据正文写一段不超过 ${input.maxLength ?? 200} 字的章节摘要，只输出摘要。`,
    selection_rewrite: "只重写选中的正文片段，保持未选中部分不变。只输出改写后的选中文本。",
    targeted_revision: "按评审问题修订选中文本块，只返回 JSON。",
  };

  return {
    system:
      input.action === "selection_rewrite"
        ? "你是长篇小说定向修订编辑。只输出改写后的选中文本，不解释，不续写选区外内容。"
        : "你是长篇小说写作助手。严格遵守作者指令和已给正文，不输出分析或解释。",
    prompt: [
      instructionByAction[input.action],
      authorInstruction,
      input.action === "selection_rewrite" ? "选中文本：" : "当前正文：",
      selected,
      references,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function hookStyleLabel(style: string | undefined): string {
  if (style === "reversal") {
    return "反转式章末钩子";
  }
  if (style === "question") {
    return "疑问式章末钩子";
  }
  return "悬念式章末钩子";
}
