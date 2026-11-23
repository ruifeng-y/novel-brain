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
const IMPORT_POLICIES = {
  manuscript: {
    label: "旧稿",
    maxUploadBytes: 2 * 1024 * 1024,
    maxFileBytes: 1024 * 1024,
    maxUncompressedBytes: 8 * 1024 * 1024,
    maxTextCharacters: 1_000_000,
    oversizeMessage: "旧稿文件不能超过 1 MB",
    rejectEmpty: false,
  },
  settings: {
    label: "设定",
    maxUploadBytes: 512 * 1024,
    maxFileBytes: 256 * 1024,
    maxUncompressedBytes: 4 * 1024 * 1024,
    maxTextCharacters: 100_000,
    oversizeMessage: "设定文件不能超过 256 KB",
    rejectEmpty: true,
  },
} as const;
export const MAX_IMPORT_UPLOAD_BYTES: Record<ImportFileKind, number> = {
  manuscript: IMPORT_POLICIES.manuscript.maxUploadBytes,
  settings: IMPORT_POLICIES.settings.maxUploadBytes,
};

export function readImportFile(file: ImportUploadFile, kind: ImportFileKind): ImportedFileText {
  const sourceName = file.originalname.trim();
  const extension = importExtension(sourceName);
  const policy = IMPORT_POLICIES[kind];
  if (
    !SUPPORTED_IMPORT_EXTENSIONS.includes(extension as (typeof SUPPORTED_IMPORT_EXTENSIONS)[number])
  ) {
    throw new ApiError(
      400,
      "VALIDATION_INVALID",
      `请选择 TXT、Markdown 或 DOCX ${policy.label}文件`,
    );
  }
  if (policy.rejectEmpty && file.size <= 0) {
    throw new ApiError(400, "VALIDATION_INVALID", `${policy.label}文件为空`);
  }
  if (file.size > policy.maxFileBytes) {
    throw new ApiError(400, "VALIDATION_INVALID", policy.oversizeMessage);
  }

  if (isDocxFileName(sourceName)) {
    try {
      const result = readDocxText(file.buffer, {
        maxCompressedBytes: policy.maxFileBytes,
        maxUncompressedBytes: policy.maxUncompressedBytes,
        maxTextCharacters: policy.maxTextCharacters,
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
