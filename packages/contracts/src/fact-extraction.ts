import { z } from 'zod';

export const factTypeSchema = z.enum(['event', 'body_state', 'character_knowledge']);

export const FACT_TYPE_LABELS: Record<z.infer<typeof factTypeSchema>, string> = {
  event: '事件',
  body_state: '身体状况',
  character_knowledge: '人物认知',
};

export const extractedFactSchema = z.object({
  type: factTypeSchema,
  statement: z.string().trim().min(1).max(500),
  sourceSentence: z.string().min(1).max(1_000),
});

export const chapterFactExtractionResultSchema = z
  .object({
    facts: z.array(extractedFactSchema).min(3).max(20),
  })
  .superRefine((value, context) => {
    const presentTypes = new Set(value.facts.map((fact) => fact.type));
    for (const requiredType of factTypeSchema.options) {
      if (!presentTypes.has(requiredType)) {
        context.addIssue({
          code: 'custom',
          path: ['facts'],
          message: `Missing required fact type: ${requiredType}`,
        });
      }
    }
  });

export const updateFactProposalSchema = z.object({
  statement: z.string().trim().min(1).max(500),
});

export const confirmFactProposalSchema = z
  .object({
    statement: z.string().trim().min(1).max(500).optional(),
  })
  .default({});

export type FactType = z.infer<typeof factTypeSchema>;
export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type ChapterFactExtractionResult = z.infer<typeof chapterFactExtractionResultSchema>;
export type UpdateFactProposalInput = z.infer<typeof updateFactProposalSchema>;
export type ConfirmFactProposalInput = z.infer<typeof confirmFactProposalSchema>;
