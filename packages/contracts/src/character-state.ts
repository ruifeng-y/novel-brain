import { z } from 'zod';

const profileTextSchema = z.string().trim().max(4_000);

export const characterProfileSaveSchema = z.object({
  desire: profileTextSchema,
  fear: profileTextSchema,
  secret: profileTextSchema,
  voice: profileTextSchema,
  arc: profileTextSchema,
});

export type CharacterProfileInput = z.infer<typeof characterProfileSaveSchema>;

export type CharacterProfile = CharacterProfileInput & {
  updatedAt: string | null;
};

export const characterKnowledgeSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  objectiveTruth: z.string().trim().min(1).max(4_000),
  characterBelief: z.string().trim().min(1).max(4_000),
  validFrom: z.string().trim().min(1).max(120),
  validTo: z.string().trim().max(120).nullable().default(null),
  source: z.string().trim().max(500).default('作者录入'),
});

const stateTextSchema = z.string().trim().max(4_000);

export const characterStateSaveSchema = z.object({
  body: stateTextSchema.optional(),
  power: stateTextSchema.optional(),
  location: stateTextSchema.optional(),
  possessions: stateTextSchema.optional(),
  disguise: stateTextSchema.optional(),
  knowledge: z.array(characterKnowledgeSchema).max(100).optional(),
  reason: z.string().trim().min(1).max(1_000).default('作者更新人物状态'),
  source: z.string().trim().max(500).default('作者录入'),
});

export type CharacterStateSaveInput = z.infer<typeof characterStateSaveSchema>;
export type CharacterKnowledgeInput = z.infer<typeof characterKnowledgeSchema>;
