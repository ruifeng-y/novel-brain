import { crc32 } from "node:zlib";

export const PRODUCTION_PAGE_IDS = [
  "auth",
  "dashboard",
  "new-project",
  "work-overview",
  "bible",
  "settings",
  "outline",
  "foreshadows",
  "writing",
  "batch",
  "changes",
  "export-publish",
  "work-settings",
  "entity-detail",
  "account-settings",
  "help",
  "legal",
];

export const STATIC_PRODUCTION_PAGE_IDS = ["help", "legal"];
export const GOLDEN_VIEWPORTS = ["390", "900", "1180", "1440"];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isValidGoldenImage(image, viewport) {
  if (
    !Buffer.isBuffer(image) ||
    image.length < 32 ||
    !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return false;
  }
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let sawImageData = false;
  while (offset + 12 <= image.length) {
    const chunkLength = image.readUInt32BE(offset);
    const chunkType = image.toString("ascii", offset + 4, offset + 8);
    const chunkDataEnd = offset + 8 + chunkLength;
    const chunkEnd = chunkDataEnd + 4;
    if (chunkEnd > image.length) return false;
    if (image.readUInt32BE(chunkDataEnd) !== crc32(image.subarray(offset + 4, chunkDataEnd))) {
      return false;
    }
    if (chunkIndex === 0) {
      if (
        chunkType !== "IHDR" ||
        chunkLength !== 13 ||
        image.readUInt32BE(offset + 8) !== Number(viewport) ||
        image.readUInt32BE(offset + 12) === 0
      ) {
        return false;
      }
    }
    if (chunkType === "IDAT" && chunkLength > 0) sawImageData = true;
    if (chunkType === "IEND") {
      return chunkLength === 0 && chunkEnd === image.length && sawImageData;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  return false;
}

export function expandGoldenPaths(goldenPathMarkdown) {
  const match = goldenPathMarkdown?.match(/`([^`]+)`/u);
  if (!match) return [];
  const template = match[1];
  const placeholder = template.match(/\{([^}]+)\}/u);
  const viewports = placeholder?.[1].split(",").map((value) => value.trim()) ?? [];
  if (
    viewports.length !== GOLDEN_VIEWPORTS.length ||
    !GOLDEN_VIEWPORTS.every((viewport) => viewports.includes(viewport))
  ) {
    return [];
  }
  return GOLDEN_VIEWPORTS.map((viewport) =>
    placeholder ? template.replace(placeholder[0], viewport) : "",
  );
}

const pipeCells = (line) => line.split("|").map((cell) => cell.trim());

export function parseTraceabilityRows(markdown) {
  return markdown
    .split(/\r?\n/u)
    .filter((line) => /^\|\s*[A-Z]+-\d{3}\s*\|/u.test(line))
    .map(pipeCells)
    .map((cells) => ({
      id: cells[1],
      capability: cells[2],
      scope: cells[3],
      status: cells[4],
      primaryIssue: cells[5],
      supporting: cells[6],
      designSource: cells[7],
      evidence: cells[8],
      milestone: cells[9],
    }));
}

export function parseUiMatrix(markdown) {
  const productionPageSet = new Set(PRODUCTION_PAGE_IDS);
  const productionRows = [];
  const prototypeOnlyRows = [];
  for (const line of markdown.split(/\r?\n/u)) {
    if (!/^\|\s*[a-z-]+\s*\|/u.test(line)) continue;
    const cells = pipeCells(line);
    const page = cells[1];
    const row = {
      page,
      primaryIssue: cells[5],
      actionApiContract: cells[7],
      requiredStates: cells[8],
      playwrightSpecPath: cells[10],
      goldenPath: cells[11],
      status: cells[12],
    };
    if (page === "states") {
      prototypeOnlyRows.push(row);
    } else if (productionPageSet.has(page)) {
      productionRows.push(row);
    }
  }
  return { productionRows, prototypeOnlyRows };
}
