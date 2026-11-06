import type {
  RevisionConstraints,
  RevisionDiffChange,
  RevisionManuscriptBlock,
} from "@novel-brain/contracts";

interface RevisionBlockInput {
  id: string;
  start: number;
  end: number;
  label?: string | undefined;
}

interface RevisionReplacement {
  blockId: string;
  text: string;
}

export interface AppliedTargetedRevision {
  content: string;
  changes: RevisionDiffChange[];
}

export interface RevisionFindingForResolution {
  findingId: string;
  evidence: Array<{ quote: string }>;
}

export interface RevisionFindingPromptInput {
  findingId: string;
  code: string;
  severity: string;
  recommendation: string;
  evidence: Array<{
    quote: string;
    locator: string;
    explanation: string;
  }>;
}

export class TargetedRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetedRevisionError";
  }
}

export function revisionFindingRisk(severity: string): "low" | "medium" | null {
  if (severity === "P3") {
    return "low";
  }
  if (severity === "P2") {
    return "medium";
  }
  return null;
}

export function revisionRoundLimitReached(completedRounds: number, maxRounds: number): boolean {
  return completedRounds >= maxRounds;
}

export function applyTargetedRevision(
  sourceContent: string,
  blocks: RevisionBlockInput[],
  generatedText: string,
): AppliedTargetedRevision {
  const ordered = validateBlocks(sourceContent, blocks);
  const replacements = parseRevisionReplacements(generatedText, ordered);
  let delta = 0;
  const changes: RevisionDiffChange[] = [];
  let cursor = 0;
  const chunks: string[] = [];

  for (const block of ordered) {
    const replacement = replacements.get(block.id)!;
    const before = sourceContent.slice(block.start, block.end);
    const afterStart = block.start + delta;
    const afterEnd = afterStart + replacement.length;
    chunks.push(sourceContent.slice(cursor, block.start), replacement);
    cursor = block.end;
    if (replacement !== before) {
      changes.push({
        blockId: block.id,
        beforeStart: block.start,
        beforeEnd: block.end,
        afterStart,
        afterEnd,
        before,
        after: replacement,
      });
    }
    delta += replacement.length - (block.end - block.start);
  }
  chunks.push(sourceContent.slice(cursor));

  if (changes.length === 0) {
    throw new TargetedRevisionError("Revision did not change any selected text");
  }
  return { content: chunks.join(""), changes };
}

export function computeUnresolvedRevisionFindings(
  findings: RevisionFindingForResolution[],
  revisedContent: string,
): string[] {
  const unresolved = findings
    .filter((finding) =>
      finding.evidence.some((evidence) => revisedContent.includes(evidence.quote)),
    )
    .map((finding) => finding.findingId);
  return [...new Set(unresolved)];
}

export interface TargetedRevisionPromptInput {
  sourceContent: string;
  blocks: RevisionBlockInput[];
  findings: RevisionFindingPromptInput[];
  constraints: RevisionConstraints;
}

export interface TargetedRevisionPrompt {
  system: string;
  prompt: string;
}

export function compileTargetedRevisionPrompt(
  input: TargetedRevisionPromptInput,
): TargetedRevisionPrompt {
  const ordered = validateBlocks(input.sourceContent, input.blocks);
  const selected = ordered.map((block) => ({
    blockId: block.id,
    label: block.label ?? block.id,
    text: input.sourceContent.slice(block.start, block.end),
  }));
  const findings = input.findings.map((finding) => ({
    findingId: finding.findingId,
    code: finding.code,
    severity: finding.severity,
    recommendation: finding.recommendation,
    evidence: finding.evidence.map((evidence) => ({
      quote: evidence.quote,
      locator: evidence.locator,
      explanation: evidence.explanation,
    })),
  }));
  return {
    system:
      "你是长篇小说定向修订编辑。只返回 JSON，不解释，不改写选区外正文，不新增未经作者确认的事实。",
    prompt: [
      "按给定评审问题修订选中文本块，保持块外正文逐字不变。",
      `输出格式：{"replacements":[{"blockId":"<文本块 ID>","text":"替换后的文本"}]}`,
      "每个选中文本块必须恰好返回一个 replacement。",
      input.constraints.authorInstruction
        ? `作者约束：${input.constraints.authorInstruction}`
        : "作者约束：保持事实、人物声线、地点和时间线不变。",
      `选中文本块：\n${JSON.stringify(selected, null, 2)}`,
      `评审问题：\n${JSON.stringify(findings, null, 2)}`,
    ].join("\n\n"),
  };
}

function validateBlocks(
  sourceContent: string,
  blocks: RevisionBlockInput[],
): RevisionManuscriptBlock[] {
  if (blocks.length === 0) {
    throw new TargetedRevisionError("At least one revision block is required");
  }
  const ids = new Set<string>();
  const ordered = [...blocks].sort((left, right) => left.start - right.start);
  for (let index = 0; index < ordered.length; index += 1) {
    const block = ordered[index]!;
    if (!block.id.trim()) {
      throw new TargetedRevisionError("Revision block id is required");
    }
    if (ids.has(block.id)) {
      throw new TargetedRevisionError(`Duplicate revision block: ${block.id}`);
    }
    ids.add(block.id);
    if (block.end <= block.start) {
      throw new TargetedRevisionError("Revision block end must follow its start");
    }
    if (block.end > sourceContent.length) {
      throw new TargetedRevisionError("Revision block is outside the source version");
    }
    const previous = ordered[index - 1];
    if (previous && block.start < previous.end) {
      throw new TargetedRevisionError("Revision blocks must not overlap");
    }
  }
  return ordered;
}

function parseRevisionReplacements(
  generatedText: string,
  blocks: RevisionManuscriptBlock[],
): Map<string, string> {
  const trimmed = generatedText.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```[^\n]*\n?/u, "").replace(/\n?```$/u, "")
    : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    if (blocks.length === 1) {
      parsed = { replacements: [{ blockId: blocks[0]!.id, text: unfenced }] };
    } else {
      throw new TargetedRevisionError("Revision response is not valid JSON");
    }
  }
  const candidates =
    Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : typeof parsed === "object" && parsed !== null && "replacements" in parsed
        ? (parsed as { replacements?: unknown }).replacements
        : undefined;
  if (!Array.isArray(candidates)) {
    throw new TargetedRevisionError("Revision response is missing replacements");
  }
  const expected = new Set(blocks.map((block) => block.id));
  const replacements = new Map<string, string>();
  for (const candidate of candidates) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as RevisionReplacement).blockId !== "string" ||
      typeof (candidate as RevisionReplacement).text !== "string"
    ) {
      throw new TargetedRevisionError("Revision replacement has an invalid shape");
    }
    const replacement = candidate as RevisionReplacement;
    if (!expected.has(replacement.blockId)) {
      throw new TargetedRevisionError(`Unknown replacement block: ${replacement.blockId}`);
    }
    if (replacements.has(replacement.blockId)) {
      throw new TargetedRevisionError(`Duplicate replacement block: ${replacement.blockId}`);
    }
    if (!replacement.text.trim()) {
      throw new TargetedRevisionError(`Replacement for ${replacement.blockId} is empty`);
    }
    replacements.set(replacement.blockId, replacement.text);
  }
  for (const blockId of expected) {
    if (!replacements.has(blockId)) {
      throw new TargetedRevisionError(`Missing replacement for block: ${blockId}`);
    }
  }
  return replacements;
}
