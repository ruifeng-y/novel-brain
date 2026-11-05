import { Inject, Injectable } from "@nestjs/common";
import { decryptApiKey, encryptApiKey, maskApiKey } from "@novel-brain/ai";
import type {
  ModelConfig,
  ModelConfigInput,
  ModelConfigUpdate,
  ModelProviderInfo,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
import {
  MODEL_CONNECTION_TESTER,
  type ConnectionTestResult,
  type ModelConnectionTester,
} from "./connection-tester";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  ModelConfigRepository,
  type ModelConfigAuditContext,
  type ModelConfigRecord,
} from "./model-config.repository";
import { listProviders, validateProviderConfig } from "./provider-registry";

@Injectable()
export class ModelConfigService {
  constructor(
    private readonly repository: ModelConfigRepository,
    @Inject(MODEL_CONNECTION_TESTER) private readonly tester: ModelConnectionTester,
  ) {}

  getProviders(): ModelProviderInfo[] {
    return listProviders();
  }

  async list(userId: string): Promise<ModelConfig[]> {
    return (await this.repository.list(userId)).map((config) => this.toContract(config));
  }

  async create(
    userId: string,
    input: ModelConfigInput,
    audit: ModelConfigAuditContext,
    idempotencyKey?: string,
  ): Promise<ModelConfig> {
    if (idempotencyKey) {
      const existing = await this.repository.findByIdempotencyKey(userId, idempotencyKey);
      if (existing) {
        return this.toContract(existing);
      }
    }
    await validateProviderConfig(input);
    let config: ModelConfigRecord;
    try {
      config = await this.repository.create({
        id: uuidv7(),
        userId,
        provider: input.provider,
        label: input.label,
        baseUrl: input.baseUrl.replace(/\/$/, ""),
        model: input.model,
        purposes: input.purposes,
        encryptedKey: encryptApiKey(input.apiKey),
        keyMasked: maskApiKey(input.apiKey),
        isDefault: input.isDefault,
        idempotencyKey: idempotencyKey ?? null,
        audit,
      });
    } catch (error) {
      if (idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.repository.findByIdempotencyKey(userId, idempotencyKey);
        if (existing) {
          return this.toContract(existing);
        }
      }
      throw error;
    }
    return this.toContract(config);
  }

  async update(
    userId: string,
    id: string,
    input: ModelConfigUpdate,
    audit: ModelConfigAuditContext,
  ): Promise<ModelConfig> {
    const existing = await this.requireConfig(userId, id);
    if (input.version !== existing.version) {
      throw new ApiError(409, "VERSION_CONFLICT", "配置已被其他操作更新，请刷新后重试");
    }
    if (input.isDefault === false && existing.isDefault) {
      const configs = await this.repository.list(userId);
      if (configs.filter((config) => config.isDefault).length === 1) {
        throw new ApiError(400, "VALIDATION_INVALID", "至少保留一个默认配置");
      }
    }
    const merged = {
      provider: existing.provider,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      model: input.model ?? existing.model,
    };
    await validateProviderConfig(merged as Pick<ModelConfigInput, "provider" | "baseUrl">);
    const config = await this.repository.update(
      userId,
      id,
      input.version,
      {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl.replace(/\/$/, "") } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.purposes !== undefined ? { purposes: input.purposes } : {}),
        ...(input.apiKey !== undefined
          ? {
              encryptedKey: encryptApiKey(input.apiKey),
              keyMasked: maskApiKey(input.apiKey),
            }
          : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
      audit,
    );
    if (!config) {
      throw new ApiError(409, "VERSION_CONFLICT", "配置已被其他操作更新，请刷新后重试");
    }
    return this.toContract(config);
  }

  async delete(userId: string, id: string, audit: ModelConfigAuditContext): Promise<void> {
    const result = await this.repository.delete(userId, id, audit);
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "模型配置不存在或无权访问");
    }
    if (result === "last_config") {
      throw new ApiError(400, "VALIDATION_INVALID", "至少保留一套默认配置");
    }
  }

  async test(userId: string, id: string): Promise<ConnectionTestResult> {
    const config = await this.requireConfig(userId, id);
    const result = await this.tester.test({
      config: this.toContract(config),
      apiKey: decryptApiKey(config.encryptedKey),
    });
    await this.repository.updateTestStatus(userId, id, result.status);
    return result;
  }

  private async requireConfig(userId: string, id: string): Promise<ModelConfigRecord> {
    const config = await this.repository.find(userId, id);
    if (!config) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "模型配置不存在或无权访问");
    }
    return config;
  }

  private toContract(config: ModelConfigRecord): ModelConfig {
    return {
      id: config.id,
      provider: config.provider as ModelConfig["provider"],
      label: config.label,
      baseUrl: config.baseUrl,
      model: config.model,
      purposes: config.purposes as ModelConfig["purposes"],
      keyMasked: config.keyMasked,
      isDefault: config.isDefault,
      version: config.version,
      lastTestStatus: config.lastTestStatus as ModelConfig["lastTestStatus"],
      lastTestedAt: config.lastTestedAt?.toISOString() ?? null,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
