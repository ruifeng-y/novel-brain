import { z } from 'zod';

export const healthCheckSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.string(),
  timestamp: z.string(),
  checks: z.record(z.string(), z.enum(['up', 'down'])).optional(),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
