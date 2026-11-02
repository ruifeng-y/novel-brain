import { z } from 'zod';

export const MAP_LEVEL_LABELS = {
  world: '世界',
  realm: '界面',
  continent: '大陆',
  region: '区域',
  city: '城市',
  location: '地点',
} as const;

export const MAP_LEVEL_ORDER = [
  'world',
  'realm',
  'continent',
  'region',
  'city',
  'location',
] as const;

export const mapLevelSchema = z.enum(MAP_LEVEL_ORDER);

export const mapNodeCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  level: mapLevelSchema,
  parentNodeId: z.string().uuid().nullable().optional(),
  summary: z.string().trim().max(2_000).default(''),
  description: z.string().trim().max(30_000).default(''),
});

export type MapNodeCreateInput = z.infer<typeof mapNodeCreateSchema>;

export const mapConnectionCreateSchema = z.object({
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  travelMinutes: z.number().int().positive().max(525_600),
  label: z.string().trim().max(200).default(''),
});

export type MapConnectionCreateInput = z.infer<typeof mapConnectionCreateSchema>;

export const mapMarkerCreateSchema = z.object({
  nodeId: z.string().uuid(),
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
});

export type MapMarkerCreateInput = z.infer<typeof mapMarkerCreateSchema>;

export const characterPresenceCreateSchema = z.object({
  characterEntityId: z.string().uuid(),
  locationNodeId: z.string().uuid(),
  storyTime: z.string().trim().min(1).max(120),
  source: z.string().trim().max(500).default('作者录入'),
});

export type CharacterPresenceCreateInput = z.infer<typeof characterPresenceCreateSchema>;
