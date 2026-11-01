import { z } from 'zod';

export const systemJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export const systemJobSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: systemJobStatusSchema,
  payload: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SystemJob = z.infer<typeof systemJobSchema>;
