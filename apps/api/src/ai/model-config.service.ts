import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  MODEL_CONFIG_MASKED_API_KEY,
  type CreateModelConfigInput,
  type ModelPurpose,
  type UpdateModelConfigInput,
} from '@novel/contracts';
import { modelConfigs, type ModelConfigRow, type NewModelConfigRow } from '@novel/db';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { AccountAuditService } from '../audit/account-audit.service';
import {
  MODEL_CONNECTION_TESTER,
  type ModelConnectionTestResult,
  type ModelConnectionTestStatus,
  type ModelConnectionTester,
} from './model-connection-tester';
import { ModelKeyCipher } from './model-key-cipher';
import { modelConfigError } from './model-configs.errors';

type EffectivePurposeSource = 'purpose' | 'prose_fallback' | 'default_fallback' | 'none';

type EffectivePurpose = {
  configId: string | null;
  name: string | null;
  model: string | null;
  source: EffectivePurposeSource;
};

type ModelConfigResponse = {
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

type AuditRequestMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

type ModelConfigListResponse = {
  items: ModelConfigResponse[];
  effectivePurposes: Record<ModelPurpose, EffectivePurpose>;
};

type ConnectionTestResponse = {
  status: ModelConnectionTestStatus;
  message: string;
  latencyMs?: number;
};

export type ModelPurposeCredentials = {
  configId: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
};

const CONNECTION_MESSAGES: Record<ModelConnectionTestStatus, string> = {
  success: 'Connection successful',
  invalid_key: 'API key is invalid',
  network_error: 'Could not reach the model provider',
};

@Injectable()
export class ModelConfigService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cipher: ModelKeyCipher,
    private readonly accountAudit: AccountAuditService,
    @Inject(MODEL_CONNECTION_TESTER) private readonly tester: ModelConnectionTester,
  ) {}

  async list(userId: string): Promise<ModelConfigListResponse> {
    const rows = await this.database.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.userId, userId))
      .orderBy(desc(modelConfigs.isDefault), modelConfigs.createdAt);

    return {
      items: rows.map((row) => this.toResponse(row)),
      effectivePurposes: this.resolvePurposes(rows),
    };
  }

  async create(
    userId: string,
    input: CreateModelConfigInput,
    requestMeta?: AuditRequestMeta,
  ): Promise<ModelConfigResponse> {
    const row = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

      const [conflict] = await tx
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(and(eq(modelConfigs.userId, userId), eq(modelConfigs.purpose, input.purpose)))
        .limit(1);
      if (conflict) {
        throw modelConfigError(
          HttpStatus.CONFLICT,
          'MODEL_CONFIG_CONFLICT',
          'A configuration already exists for this purpose',
        );
      }

      const existing = await tx
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(eq(modelConfigs.userId, userId))
        .limit(1);
      const shouldBeDefault = input.isDefault === true || existing.length === 0;
      const now = new Date();

      if (shouldBeDefault) {
        await tx
          .update(modelConfigs)
          .set({ isDefault: false })
          .where(and(eq(modelConfigs.userId, userId), eq(modelConfigs.isDefault, true)));
      }

      const [created] = await tx
        .insert(modelConfigs)
        .values({
          userId,
          name: input.name,
          provider: input.provider,
          baseUrl: input.baseUrl,
          encryptedApiKey: this.cipher.encrypt(input.apiKey),
          model: input.model,
          purpose: input.purpose,
          isDefault: shouldBeDefault,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return created;
    });

    await this.accountAudit.record({
      userId,
      action: 'account_model_key_created',
      targetType: 'model_config',
      targetId: row.id,
      title: '添加模型 Key',
      detail: `添加模型配置「${row.name}」`,
      metadata: {
        configId: row.id,
        name: row.name,
        provider: row.provider,
        baseUrl: row.baseUrl,
        model: row.model,
        purpose: row.purpose,
        keyChanged: true,
      },
      ...requestMeta,
    });
    return this.toResponse(row);
  }

  async get(userId: string, configId: string): Promise<ModelConfigResponse> {
    return this.toResponse(await this.findOwned(userId, configId));
  }

  async update(
    userId: string,
    configId: string,
    input: UpdateModelConfigInput,
    requestMeta?: AuditRequestMeta,
  ): Promise<ModelConfigResponse> {
    const row = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

      const [current] = await tx
        .select()
        .from(modelConfigs)
        .where(and(eq(modelConfigs.id, configId), eq(modelConfigs.userId, userId)))
        .limit(1);
      if (!current) {
        throw this.notFound();
      }

      if (input.purpose && input.purpose !== current.purpose) {
        const [conflict] = await tx
          .select({ id: modelConfigs.id })
          .from(modelConfigs)
          .where(
            and(
              eq(modelConfigs.userId, userId),
              eq(modelConfigs.purpose, input.purpose),
              ne(modelConfigs.id, configId),
            ),
          )
          .limit(1);
        if (conflict) {
          throw modelConfigError(
            HttpStatus.CONFLICT,
            'MODEL_CONFIG_CONFLICT',
            'A configuration already exists for this purpose',
          );
        }
      }

      const changes: Partial<NewModelConfigRow> = { updatedAt: new Date() };
      if (input.name !== undefined) changes.name = input.name;
      if (input.provider !== undefined) changes.provider = input.provider;
      if (input.baseUrl !== undefined) changes.baseUrl = input.baseUrl;
      if (input.model !== undefined) changes.model = input.model;
      if (input.purpose !== undefined) changes.purpose = input.purpose;
      if (input.apiKey !== undefined) {
        changes.encryptedApiKey = this.cipher.encrypt(input.apiKey);
      }

      if (input.isDefault === true) {
        await tx
          .update(modelConfigs)
          .set({ isDefault: false })
          .where(and(eq(modelConfigs.userId, userId), eq(modelConfigs.isDefault, true)));
        changes.isDefault = true;
      }

      const [updated] = await tx
        .update(modelConfigs)
        .set(changes)
        .where(and(eq(modelConfigs.id, configId), eq(modelConfigs.userId, userId)))
        .returning();

      return updated;
    });

    if (input.apiKey !== undefined) {
      await this.accountAudit.record({
        userId,
        action: 'account_model_key_updated',
        targetType: 'model_config',
        targetId: row.id,
        title: '更新模型 Key',
        detail: `更新模型配置「${row.name}」的凭证`,
        metadata: {
          configId: row.id,
          name: row.name,
          provider: row.provider,
          baseUrl: row.baseUrl,
          model: row.model,
          purpose: row.purpose,
          keyChanged: true,
        },
        ...requestMeta,
      });
    }
    return this.toResponse(row);
  }

  async remove(
    userId: string,
    configId: string,
    requestMeta?: AuditRequestMeta,
  ): Promise<void> {
    let removed: { name: string; purpose: string } | undefined;
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

      const [deleted] = await tx
        .delete(modelConfigs)
        .where(and(eq(modelConfigs.id, configId), eq(modelConfigs.userId, userId)))
        .returning({
          id: modelConfigs.id,
          name: modelConfigs.name,
          purpose: modelConfigs.purpose,
          isDefault: modelConfigs.isDefault,
        });
      if (!deleted) {
        throw this.notFound();
      }
      removed = deleted;

      if (!deleted.isDefault) {
        return;
      }

      const remaining = await tx
        .select()
        .from(modelConfigs)
        .where(eq(modelConfigs.userId, userId))
        .orderBy(modelConfigs.createdAt);
      const replacement =
        remaining.find((candidate) => candidate.purpose === 'prose') ?? remaining[0];
      if (replacement) {
        await tx
          .update(modelConfigs)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(and(eq(modelConfigs.id, replacement.id), eq(modelConfigs.userId, userId)));
      }
    });
    if (removed) {
      await this.accountAudit.record({
        userId,
        action: 'account_model_key_deleted',
        targetType: 'model_config',
        targetId: configId,
        title: '删除模型 Key',
        detail: `删除模型配置「${removed.name}」及其凭证`,
        metadata: {
          configId,
          name: removed.name,
          purpose: removed.purpose,
          keyChanged: true,
        },
        ...requestMeta,
      });
    }
  }

  async testConnection(userId: string, configId: string): Promise<ConnectionTestResponse> {
    const row = await this.findOwned(userId, configId);
    const apiKey = this.cipher.decrypt(row.encryptedApiKey);

    let result: ModelConnectionTestResult;
    try {
      result = await this.tester.test({
        baseUrl: row.baseUrl,
        apiKey,
        model: row.model,
      });
    } catch {
      result = {
        status: 'network_error',
        message: CONNECTION_MESSAGES.network_error,
      };
    }

    return {
      status: result.status,
      message: CONNECTION_MESSAGES[result.status],
      ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
    };
  }

  async purposeCredentials(
    userId: string,
    purpose: ModelPurpose,
  ): Promise<ModelPurposeCredentials | null> {
    const rows = await this.database.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.userId, userId))
      .orderBy(desc(modelConfigs.isDefault), modelConfigs.createdAt);
    const row =
      rows.find((candidate) => candidate.purpose === purpose) ??
      rows.find((candidate) => candidate.purpose === 'prose') ??
      rows.find((candidate) => candidate.isDefault) ??
      rows[0];
    if (!row) {
      return null;
    }

    return {
      configId: row.id,
      name: row.name,
      model: row.model,
      baseUrl: row.baseUrl,
      apiKey: this.cipher.decrypt(row.encryptedApiKey),
    };
  }

  private async findOwned(userId: string, configId: string): Promise<ModelConfigRow> {
    const [row] = await this.database.db
      .select()
      .from(modelConfigs)
      .where(and(eq(modelConfigs.id, configId), eq(modelConfigs.userId, userId)))
      .limit(1);
    if (!row) {
      throw this.notFound();
    }
    return row;
  }

  private resolvePurposes(rows: ModelConfigRow[]): Record<ModelPurpose, EffectivePurpose> {
    const prose = rows.find((row) => row.purpose === 'prose');
    const fallback = rows.find((row) => row.isDefault);

    const resolve = (purpose: ModelPurpose): EffectivePurpose => {
      const direct = rows.find((row) => row.purpose === purpose);
      if (direct) {
        return this.toEffectivePurpose(direct, 'purpose');
      }
      if (purpose !== 'prose' && prose) {
        return this.toEffectivePurpose(prose, 'prose_fallback');
      }
      if (fallback) {
        return this.toEffectivePurpose(fallback, 'default_fallback');
      }
      return {
        configId: null,
        name: null,
        model: null,
        source: 'none',
      };
    };

    return {
      planning: resolve('planning'),
      prose: resolve('prose'),
      check: resolve('check'),
    };
  }

  private toEffectivePurpose(
    row: ModelConfigRow,
    source: EffectivePurposeSource,
  ): EffectivePurpose {
    return {
      configId: row.id,
      name: row.name,
      model: row.model,
      source,
    };
  }

  private toResponse(row: ModelConfigRow): ModelConfigResponse {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      purpose: row.purpose,
      isDefault: row.isDefault,
      apiKeyMasked: MODEL_CONFIG_MASKED_API_KEY,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private notFound() {
    return modelConfigError(
      HttpStatus.NOT_FOUND,
      'MODEL_CONFIG_NOT_FOUND',
      'Model configuration not found',
    );
  }
}
