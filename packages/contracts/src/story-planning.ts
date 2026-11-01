import { z } from 'zod';

export const storyBibleSchema = z.object({
  oneSentenceStory: z.string().trim().min(1).max(500),
  protagonist: z.string().trim().min(1).max(200),
  worldIronLaw: z.string().trim().min(1).max(500),
});

export const chapterOutlineSchema = z.object({
  chapterGoal: z.string().trim().min(1).max(1_000),
  pov: z.string().trim().min(1).max(120),
  sceneBeats: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  chapterEndHook: z.string().trim().min(1).max(500),
});

export const chapterNumberSchema = z.coerce.number().int().min(1).max(100_000);

export type StoryBibleInput = z.infer<typeof storyBibleSchema>;
export type ChapterOutlineInput = z.infer<typeof chapterOutlineSchema>;
