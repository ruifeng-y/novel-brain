import type { ManuscriptImportFormat } from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import {
  DocxImportError,
  docxImportErrorMessage,
  isDocxFileName,
  readDocxText,
} from "./docx-reader";

export type ImportFileKind = "manuscript" | "settings";

export interface ImportUploadFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface ImportedFileText {
  text: string;
  format: ManuscriptImportFormat;
  headingStarts: number[];
}

export const SUPPORTED_IMPORT_EXTENSIONS = [".txt", ".md", ".markdown", ".docx"] as const;
export const MAX_IMPORT_UPLOAD_BYTES: Record<ImportFileKind, number> = {
  manuscript: 2 * 1024 * 1024,
  settings: 512 * 1024,
};
const MAX_IMPORT_FILE_BYTES: Record<ImportFileKind, number> = {
  manuscript: 1024 * 1024,
  settings: 256 * 1024,
};
const MAX_DOCX_UNCOMPRESSED_BYTES: Record<ImportFileKind, number> = {
  manuscript: 8 * 1024 * 1024,
  settings: 4 * 1024 * 1024,
};
const MAX_IMPORT_TEXT_CHARACTERS: Record<ImportFileKind, number> = {
  manuscript: 1_000_000,
  settings: 100_000,
};

export function readImportFile(file: ImportUploadFile, kind: ImportFileKind): ImportedFileText {
  const sourceName = file.originalname.trim();
  const extension = importExtension(sourceName);
  const label = kind === "manuscript" ? "旧稿" : "设定";
  if (
    !SUPPORTED_IMPORT_EXTENSIONS.includes(extension as (typeof SUPPORTED_IMPORT_EXTENSIONS)[number])
  ) {
    throw new ApiError(400, "VALIDATION_INVALID", `请选择 TXT、Markdown 或 DOCX ${label}文件`);
  }
  if (kind === "settings" && file.size <= 0) {
    throw new ApiError(400, "VALIDATION_INVALID", "设定文件为空");
  }
  if (file.size > MAX_IMPORT_FILE_BYTES[kind]) {
    throw new ApiError(
      400,
      "VALIDATION_INVALID",
      kind === "manuscript" ? "旧稿文件不能超过 1 MB" : "设定文件不能超过 256 KB",
    );
  }

  if (isDocxFileName(sourceName)) {
    try {
      const result = readDocxText(file.buffer, {
        maxCompressedBytes: MAX_IMPORT_FILE_BYTES[kind],
        maxUncompressedBytes: MAX_DOCX_UNCOMPRESSED_BYTES[kind],
        maxTextCharacters: MAX_IMPORT_TEXT_CHARACTERS[kind],
      });
      return {
        text: result.text,
        format: "docx",
        headingStarts: result.headingStarts,
      };
    } catch (error) {
      if (error instanceof DocxImportError) {
        throw new ApiError(400, "VALIDATION_INVALID", docxImportErrorMessage(kind, error.reason));
      }
      throw error;
    }
  }

  return {
    text: kind === "manuscript" ? decodeUtf8(file.buffer) : file.buffer.toString("utf8").trim(),
    format: formatFromName(sourceName),
    headingStarts: [],
  };
}

export function formatFromName(sourceName: string | null): ManuscriptImportFormat {
  const normalized = sourceName?.toLowerCase() ?? "";
  if (normalized.endsWith(".docx")) {
    return "docx";
  }
  return normalized.match(/\.(?:md|markdown)$/u) ? "markdown" : "txt";
}

function importExtension(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ApiError(400, "VALIDATION_INVALID", "旧稿编码无法解析，请使用 UTF-8 编码");
  }
}
