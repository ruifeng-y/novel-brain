import { createHash } from "node:crypto";

export const LARGE_MANUSCRIPT_SPEC = {
  seed: "novelbrain-import-recovery-v1",
  version: 1,
  characterCount: 10_000_000,
  chapterCount: 1_000,
  chapterCharacterCount: 10_000,
  chunkCharacterCount: 250_000,
} as const;

export interface LargeManuscriptMetadata {
  seed: string;
  version: number;
  characterCount: number;
  chapterCount: number;
  chunkCharacterCount: number;
  chunkCount: number;
  sha256: string;
}

let cachedMetadata: LargeManuscriptMetadata | undefined;

export function largeManuscriptChunks(
  chunkCharacterCount = LARGE_MANUSCRIPT_SPEC.chunkCharacterCount,
): Generator<string> {
  return chunks(chunkCharacterCount);
}

export function largeManuscriptMetadata(): LargeManuscriptMetadata {
  if (cachedMetadata) {
    return cachedMetadata;
  }
  const hash = createHash("sha256");
  let chunkCount = 0;
  for (const chunk of chunks(LARGE_MANUSCRIPT_SPEC.chunkCharacterCount)) {
    hash.update(chunk);
    chunkCount += 1;
  }
  cachedMetadata = {
    seed: LARGE_MANUSCRIPT_SPEC.seed,
    version: LARGE_MANUSCRIPT_SPEC.version,
    characterCount: LARGE_MANUSCRIPT_SPEC.characterCount,
    chapterCount: LARGE_MANUSCRIPT_SPEC.chapterCount,
    chunkCharacterCount: LARGE_MANUSCRIPT_SPEC.chunkCharacterCount,
    chunkCount,
    sha256: hash.digest("hex"),
  };
  return cachedMetadata;
}

export function largeManuscriptText(): string {
  return Array.from(largeManuscriptChunks()).join("");
}

function* chunks(chunkCharacterCount: number): Generator<string> {
  let pending = "";
  for (let index = 1; index <= LARGE_MANUSCRIPT_SPEC.chapterCount; index += 1) {
    pending += chapterText(index);
    while (pending.length >= chunkCharacterCount) {
      yield pending.slice(0, chunkCharacterCount);
      pending = pending.slice(chunkCharacterCount);
    }
  }
  if (pending) {
    yield pending;
  }
}

function chapterText(index: number): string {
  const header = `第${index}章 分块旧稿${String(index).padStart(4, "0")}\n`;
  const bodyPrefix = `沈砚在第${index}章沿忘川河继续赶路。`;
  const filler = "风吹过断碑，夜色压在河面上。";
  const bodyLength = LARGE_MANUSCRIPT_SPEC.chapterCharacterCount - header.length - 1;
  const body = `${bodyPrefix}${filler.repeat(
    Math.ceil((bodyLength - bodyPrefix.length) / filler.length),
  )}`.slice(0, bodyLength);
  return `${header}${body}\n`;
}
