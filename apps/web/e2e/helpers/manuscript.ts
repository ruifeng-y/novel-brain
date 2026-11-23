export function buildChunkedManuscriptFixture(): Buffer {
  const chapters: string[] = [];
  for (let index = 1; index <= 8; index += 1) {
    const header = `第${index}章 分块旧稿${String(index).padStart(4, "0")}\n`;
    const bodyPrefix = `沈砚在第${index}章沿忘川河继续赶路。`;
    const filler = "风吹过断碑，夜色压在河面上。";
    const bodyLength = 220_000 - header.length - 1;
    const body = `${bodyPrefix}${filler.repeat(
      Math.ceil((bodyLength - bodyPrefix.length) / filler.length),
    )}`.slice(0, bodyLength);
    chapters.push(`${header}${body}\n`);
  }
  return Buffer.from(chapters.join(""), "utf8");
}
