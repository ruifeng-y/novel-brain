import { z } from 'zod';

export const changeTargetTypeSchema = z.enum([
  'entity',
  'outline',
  'chapter',
  'fact',
  'knowledge',
  'plot_line',
  'map',
  'faction',
  'power_item',
  'timeline',
  'story_bible',
  'work',
]);

export type ChangeTargetType = z.infer<typeof changeTargetTypeSchema>;

export const CHANGE_TARGET_TYPE_LABELS: Record<ChangeTargetType, string> = {
  entity: '设定条目',
  outline: '大纲节点',
  chapter: '章节',
  fact: '已确认设定',
  knowledge: '人物认知',
  plot_line: '剧情线',
  map: '地图地点',
  faction: '势力',
  power_item: '力量或物品',
  timeline: '时间线事件',
  story_bible: '故事圣经',
  work: '作品信息',
};

export const changeSourceSchema = z.enum(['author', 'ai', 'import', 'batch']);
export type ChangeSource = z.infer<typeof changeSourceSchema>;

export const CHANGE_SOURCE_LABELS: Record<ChangeSource, string> = {
  author: '作者直接修改',
  ai: 'AI 提案',
  import: '导入',
  batch: '批量任务',
};

export const changeRiskSchema = z.enum(['low', 'medium', 'high']);
export type ChangeRisk = z.infer<typeof changeRiskSchema>;

export const CHANGE_RISK_LABELS: Record<ChangeRisk, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export const changeRequestStatusSchema = z.enum([
  'draft',
  'analyzing',
  'waiting_confirmation',
  'applying',
  'applied',
  'rejected',
  'canceled',
  'failed',
  'branched',
]);
export type ChangeRequestStatus = z.infer<typeof changeRequestStatusSchema>;

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  draft: '草稿',
  analyzing: '分析中',
  waiting_confirmation: '等待确认',
  applying: '应用中',
  applied: '已应用',
  rejected: '已驳回',
  canceled: '已取消',
  failed: '应用失败',
  branched: '已拉平行版本',
};

export const changeClassificationSchema = z.enum(['safe', 'repairable', 'structural']);
export type ChangeClassification = z.infer<typeof changeClassificationSchema>;

export const CHANGE_CLASSIFICATION_LABELS: Record<ChangeClassification, string> = {
  safe: '可以直接应用',
  repairable: '修复后应用',
  structural: '需要另开版本',
};

export const changeCheckStepSchema = z.enum([
  'structure',
  'hard_rules',
  'fact_diff',
  'knowledge_pov',
  'narrative',
  'downstream',
]);

export const changeCheckStatusSchema = z.enum(['passed', 'warning', 'conflict']);

const changeValueSchema = z.record(z.string(), z.unknown());

export const createChangeRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(2_000),
    targetType: changeTargetTypeSchema,
    targetId: z.string().uuid().nullable().optional(),
    oldValue: changeValueSchema.default({}),
    newValue: changeValueSchema,
    source: changeSourceSchema.default('author'),
    risk: changeRiskSchema.default('medium'),
  })
  .superRefine((value, context) => {
    if (Object.keys(value.newValue).length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['newValue'],
        message: 'Add at least one proposed field',
      });
    }
    if (value.targetType !== 'story_bible' && value.targetType !== 'work' && !value.targetId) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'Choose the content to change',
      });
    }
  });

export type CreateChangeRequestInput = z.infer<typeof createChangeRequestSchema>;

export const applyChangeRequestSchema = z
  .object({
    mode: z.enum(['apply', 'repair']).default('apply'),
    repairNotes: z.string().trim().max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === 'repair' && !value.repairNotes) {
      context.addIssue({
        code: 'custom',
        path: ['repairNotes'],
        message: 'Describe how the affected content was repaired',
      });
    }
  });

export type ApplyChangeRequestInput = z.infer<typeof applyChangeRequestSchema>;

export const branchChangeRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type BranchChangeRequestInput = z.infer<typeof branchChangeRequestSchema>;

export const cancelChangeRequestSchema = z.object({
  reason: z.string().trim().max(2_000).optional(),
});

export type CancelChangeRequestInput = z.infer<typeof cancelChangeRequestSchema>;

export const falsePositiveSchema = z.object({
  validationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1_000),
});

export type FalsePositiveInput = z.infer<typeof falsePositiveSchema>;

export type ChangeDiffEntry = {
  field: string;
  before: unknown;
  after: unknown;
};
