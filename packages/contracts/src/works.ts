import { z } from 'zod';

export const workGenrePackSchema = z.enum(['xianxia', 'urban']);
export const workScaleSchema = z.enum(['short', 'medium', 'long', 'epic']);
export const workStatusSchema = z.enum([
  'preparing',
  'serializing',
  'paused',
  'completed',
  'archived',
]);

export const createWorkSchema = z.object({
  title: z.string().trim().min(1).max(120),
  penName: z.string().trim().min(1).max(60),
  genrePack: workGenrePackSchema,
  scale: workScaleSchema,
  targetPlatform: z.string().trim().min(1).max(80),
});

export const workIdSchema = z.string().uuid();

export const WORK_STATUS_LABELS: Record<z.infer<typeof workStatusSchema>, string> = {
  preparing: '筹备中',
  serializing: '连载中',
  paused: '暂停',
  completed: '已完本',
  archived: '已归档',
};

export type CreateWorkInput = z.infer<typeof createWorkSchema>;
export type WorkGenrePack = z.infer<typeof workGenrePackSchema>;
export type WorkScale = z.infer<typeof workScaleSchema>;
export type WorkStatus = z.infer<typeof workStatusSchema>;
