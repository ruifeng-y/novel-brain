import { z } from 'zod';

export const parallelVersionKindSchema = z.enum([
  'rewrite',
  'what_if',
  'alternate_ending',
  'experiment',
]);

export type ParallelVersionKind = z.infer<typeof parallelVersionKindSchema>;

export const PARALLEL_VERSION_KIND_LABELS: Record<ParallelVersionKind, string> = {
  rewrite: '重写',
  what_if: '另一种可能',
  alternate_ending: '另一结局',
  experiment: '实验',
};

export const parallelVersionStatusSchema = z.enum(['active', 'archived']);
export type ParallelVersionStatus = z.infer<typeof parallelVersionStatusSchema>;

export const PARALLEL_VERSION_STATUS_LABELS: Record<ParallelVersionStatus, string> = {
  active: '进行中',
  archived: '已归档',
};

export const forkPointKindSchema = z.enum(['current', 'chapter_version']);
export type ForkPointKind = z.infer<typeof forkPointKindSchema>;

export const versionPointIdSchema = z.union([z.literal('current'), z.string().uuid()]);

export const createParallelVersionSchema = z.object({
  sourceBranchId: z.string().uuid(),
  versionPointId: versionPointIdSchema.default('current'),
  name: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(2_000),
  kind: parallelVersionKindSchema.default('experiment'),
});

export type CreateParallelVersionInput = z.infer<typeof createParallelVersionSchema>;

export const compareParallelVersionSchema = z.object({
  withBranchId: z.string().uuid(),
});

export type CompareParallelVersionInput = z.infer<typeof compareParallelVersionSchema>;

export const cherryPickItemTypeSchema = z.enum(['chapter', 'setting', 'outline']);
export type CherryPickItemType = z.infer<typeof cherryPickItemTypeSchema>;

export const CHERRY_PICK_ITEM_TYPE_LABELS: Record<CherryPickItemType, string> = {
  chapter: '章节',
  setting: '设定',
  outline: '大纲节点',
};

export const cherryPickSchema = z.object({
  targetBranchId: z.string().uuid(),
  items: z
    .array(
      z.object({
        type: cherryPickItemTypeSchema,
        id: z.string().uuid(),
      }),
    )
    .min(1)
    .max(50),
});

export type CherryPickInput = z.infer<typeof cherryPickSchema>;
