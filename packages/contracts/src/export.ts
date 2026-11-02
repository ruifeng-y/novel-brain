import { z } from 'zod';

export const manuscriptExportFormatSchema = z.enum(['txt', 'markdown', 'docx', 'epub']);
export type ManuscriptExportFormat = z.infer<typeof manuscriptExportFormatSchema>;

export const outlineExportFormatSchema = z.enum(['markdown', 'json']);
export type OutlineExportFormat = z.infer<typeof outlineExportFormatSchema>;

export const exportFormatSchema = z.enum(['txt', 'markdown', 'docx', 'epub', 'json', 'zip']);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  txt: 'TXT',
  markdown: 'Markdown',
  docx: 'Word 文档',
  epub: 'EPUB 电子书',
  json: 'JSON 文件',
  zip: 'ZIP 压缩包',
};

export const exportKindSchema = z.enum(['manuscript', 'outline', 'version']);
export type ExportKind = z.infer<typeof exportKindSchema>;

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  manuscript: '正文',
  outline: '大纲',
  version: '历史版本',
};

export const exportPresetSchema = z.enum(['generic', 'qidian', 'fanqie']);
export type ExportPreset = z.infer<typeof exportPresetSchema>;

export const EXPORT_PRESET_LABELS: Record<ExportPreset, string> = {
  generic: '通用网文',
  qidian: '起点',
  fanqie: '番茄',
};

const chapterNumberSchema = z.coerce.number().int().min(1).max(100_000);

export const manuscriptExportScopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chapter'),
    chapterNumber: chapterNumberSchema,
  }),
  z.object({
    type: z.literal('chapters'),
    chapterNumbers: z.array(chapterNumberSchema).min(1).max(1_000),
  }),
  z.object({
    type: z.literal('range'),
    startChapter: chapterNumberSchema,
    endChapter: chapterNumberSchema,
  }),
  z.object({
    type: z.literal('volume'),
    volumeId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('book'),
  }),
]);
export type ManuscriptExportScope = z.infer<typeof manuscriptExportScopeSchema>;

export const exportScopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chapter'),
    chapterNumber: chapterNumberSchema,
  }),
  z.object({
    type: z.literal('chapters'),
    chapterNumbers: z.array(chapterNumberSchema).min(1).max(1_000),
  }),
  z.object({
    type: z.literal('range'),
    startChapter: chapterNumberSchema,
    endChapter: chapterNumberSchema,
  }),
  z.object({
    type: z.literal('volume'),
    volumeId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('book'),
  }),
  z.object({
    type: z.literal('outline'),
  }),
  z.object({
    type: z.literal('version'),
    versionCommitId: z.string().uuid(),
  }),
]);
export type ExportScope = z.infer<typeof exportScopeSchema>;

export const EXPORT_SCOPE_LABELS: Record<ExportScope['type'], string> = {
  chapter: '当前章',
  chapters: '选中章节',
  range: '自定义区间',
  volume: '整卷',
  book: '全本',
  outline: '全文大纲',
  version: '历史版本',
};

export const exportOptionsSchema = z.object({
  preset: exportPresetSchema.default('generic'),
  chapterTitlePattern: z.string().trim().min(1).max(180).optional(),
  volumeTitlePattern: z.string().trim().min(1).max(180).optional(),
  paragraphSpacing: z.coerce
    .number()
    .int()
    .min(0)
    .max(2)
    .transform((value) => value as 0 | 1 | 2)
    .optional(),
  firstLineIndent: z.boolean().optional(),
  encoding: z.literal('utf-8').default('utf-8'),
});
export type ExportOptions = z.infer<typeof exportOptionsSchema>;

const defaultExportOptions = exportOptionsSchema.parse({ preset: 'generic' });

export const createExportRequestSchema = z
  .object({
    format: manuscriptExportFormatSchema,
    scope: manuscriptExportScopeSchema,
    options: exportOptionsSchema.default(defaultExportOptions),
  })
  .superRefine((value, context) => {
    if (
      value.scope.type === 'chapters' &&
      new Set(value.scope.chapterNumbers).size !== value.scope.chapterNumbers.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['scope', 'chapterNumbers'],
        message: 'Each chapter can appear only once',
      });
    }
    if (value.scope.type === 'range' && value.scope.startChapter > value.scope.endChapter) {
      context.addIssue({
        code: 'custom',
        path: ['scope', 'endChapter'],
        message: 'endChapter must be greater than or equal to startChapter',
      });
    }
  });
export type CreateExportRequest = z.infer<typeof createExportRequestSchema>;

export const exportPreviewRequestSchema = z.object({
  format: manuscriptExportFormatSchema,
  scope: manuscriptExportScopeSchema,
  options: exportOptionsSchema.default(defaultExportOptions),
  previewChapterCount: z.coerce.number().int().min(1).max(5).default(3),
});
export type ExportPreviewRequest = z.infer<typeof exportPreviewRequestSchema>;

export const createOutlineExportRequestSchema = z.object({
  format: outlineExportFormatSchema.default('markdown'),
});
export type CreateOutlineExportRequest = z.infer<typeof createOutlineExportRequestSchema>;

const historicalVersionExportRequestBaseSchema = z.object({
  versionCommitId: z.string().uuid().optional(),
  versionId: z.string().uuid().optional(),
});

export const createHistoricalVersionExportRequestSchema =
  historicalVersionExportRequestBaseSchema
    .refine((value) => Boolean(value.versionCommitId ?? value.versionId), {
      message: 'Choose a historical version',
      path: ['versionCommitId'],
    })
    .transform((value) => ({
      versionCommitId: value.versionCommitId ?? value.versionId!,
    }));
export type CreateHistoricalVersionExportRequest = z.infer<
  typeof createHistoricalVersionExportRequestSchema
>;

export const exportStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export type ExportStatus = z.infer<typeof exportStatusSchema>;

export const EXPORT_STATUS_LABELS: Record<ExportStatus | 'expired', string> = {
  queued: '排队中',
  running: '正在整理',
  completed: '可下载',
  failed: '导出失败',
  expired: '已过期',
};

export type ExportHistoryItem = {
  id: string;
  kind: ExportKind;
  kindLabel: string;
  format: ExportFormat;
  formatLabel: string;
  preset: ExportPreset;
  presetLabel: string;
  scope: ExportScope;
  scopeLabel: string;
  status: ExportStatus | 'expired';
  statusLabel: string;
  progress: number;
  chapterCount: number;
  fileName: string | null;
  fileSize: number | null;
  error: string | null;
  downloadUrl: string | null;
  branch: {
    id: string;
    name: string;
  };
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  version: {
    id: string;
    title: string;
  } | null;
};

export type ExportPreviewChapter = {
  chapterNumber: number;
  title: string;
  volumeTitle: string;
  excerpt: string;
};

export type ExportPreview = {
  scope: ExportScope;
  scopeLabel: string;
  format: ExportFormat;
  preset: ExportPreset;
  chapterCount: number;
  wordCount: number;
  tableOfContents: Array<{
    volumeTitle: string;
    chapters: Array<{ chapterNumber: number; title: string }>;
  }>;
  chapters: ExportPreviewChapter[];
  sample: string;
};
