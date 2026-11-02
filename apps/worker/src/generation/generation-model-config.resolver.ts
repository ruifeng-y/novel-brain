import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptModelKey } from '@novel/ai';
import { modelConfigs } from '@novel/db';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';

export type ResolvedGenerationModel = {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
};

@Injectable()
export class GenerationModelConfigResolver {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async resolve(userId: string, modelConfigId?: string): Promise<ResolvedGenerationModel> {
    const rows = await this.database.db
      .select()
      .from(modelConfigs)
      .where(
        modelConfigId
          ? and(eq(modelConfigs.userId, userId), eq(modelConfigs.id, modelConfigId))
          : eq(modelConfigs.userId, userId),
      )
      .orderBy(desc(modelConfigs.isDefault), modelConfigs.createdAt);
    const selected =
      rows.find((row) => row.id === modelConfigId) ??
      rows.find((row) => row.purpose === 'prose') ??
      rows.find((row) => row.isDefault);

    if (!selected) {
      throw new Error('MODEL_CONFIG_REQUIRED');
    }

    return {
      id: selected.id,
      name: selected.name,
      model: selected.model,
      baseUrl: selected.baseUrl,
      apiKey: decryptModelKey(
        selected.encryptedApiKey,
        this.config.getOrThrow<string>('MODEL_KEY_ENCRYPTION_KEY'),
      ),
    };
  }
}
