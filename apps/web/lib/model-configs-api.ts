import { ApiError, friendlyError } from './auth-api';

export type ModelPurpose = 'planning' | 'prose' | 'check';
export type ConnectionStatus = 'success' | 'invalid_key' | 'network_error';

export type ModelConfig = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  purpose: ModelPurpose;
  isDefault: boolean;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
};

export type EffectivePurpose = {
  configId: string | null;
  name: string | null;
  model: string | null;
  source: 'purpose' | 'prose_fallback' | 'default_fallback' | 'none';
};

export type ModelConfigListResponse = {
  items: ModelConfig[];
  effectivePurposes: Record<ModelPurpose, EffectivePurpose>;
};

export type ConnectionTestResponse = {
  status: ConnectionStatus;
  message: string;
  latencyMs?: number;
};

export const PURPOSE_LABELS: Record<ModelPurpose, string> = {
  planning: '规划',
  prose: '正文',
  check: '校验',
};

export const PURPOSE_DESCRIPTIONS: Record<ModelPurpose, string> = {
  planning: '整理故事方向、章节规划和创作任务。',
  prose: '生成和续写章节正文。',
  check: '检查设定、时间线和前后文是否一致。',
};

export function friendlyModelConfigError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'MODEL_CONFIG_CONFLICT') {
      return '这个用途已经有一套配置，请编辑或删除原来的配置。';
    }
    if (error.code === 'MODEL_CONFIG_NOT_FOUND') {
      return '没有找到这套配置，它可能已被删除。';
    }
    if (error.code === 'VALIDATION_ERROR') {
      return '请检查名称、地址、模型名和 API Key 是否填写完整。';
    }
  }

  return friendlyError(error);
}
