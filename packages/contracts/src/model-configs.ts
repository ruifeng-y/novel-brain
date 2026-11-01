import { z } from 'zod';

export const modelProviderSchema = z.literal('deepseek');
export const modelPurposeSchema = z.enum(['planning', 'prose', 'check']);

const baseUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
    message: 'Base URL must use http or https',
  });

const modelNameSchema = z.string().trim().min(1).max(120);
const apiKeySchema = z.string().trim().min(1).max(4096);

export const createModelConfigSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: modelProviderSchema.default('deepseek'),
  baseUrl: baseUrlSchema.default('https://api.deepseek.com'),
  model: modelNameSchema.default('deepseek-chat'),
  apiKey: apiKeySchema,
  purpose: modelPurposeSchema.default('prose'),
  isDefault: z.boolean().optional(),
});

export const updateModelConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    provider: modelProviderSchema.optional(),
    baseUrl: baseUrlSchema.optional(),
    model: modelNameSchema.optional(),
    apiKey: apiKeySchema.optional(),
    purpose: modelPurposeSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const modelConfigIdSchema = z.string().uuid();

export const MODEL_CONFIG_MASKED_API_KEY = '••••••••';

export const MODEL_PURPOSE_LABELS: Record<z.infer<typeof modelPurposeSchema>, string> = {
  planning: '规划',
  prose: '正文',
  check: '校验',
};

export const MODEL_PROVIDER_LABELS: Record<z.infer<typeof modelProviderSchema>, string> = {
  deepseek: 'DeepSeek',
};

export type CreateModelConfigInput = z.infer<typeof createModelConfigSchema>;
export type UpdateModelConfigInput = z.infer<typeof updateModelConfigSchema>;
export type ModelPurpose = z.infer<typeof modelPurposeSchema>;
export type ModelProvider = z.infer<typeof modelProviderSchema>;
