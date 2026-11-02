import { z } from 'zod';

export const storyBibleCardKeySchema = z.enum([
  'oneSentence',
  'sellingPoints',
  'protagonist',
  'goldenFinger',
  'worldIronLaws',
  'mainPlot',
  'subplots',
  'ending',
  'readerPromise',
]);

export type StoryBibleCardKey = z.infer<typeof storyBibleCardKeySchema>;

export const STORY_BIBLE_CARD_DEFINITIONS: ReadonlyArray<{
  key: StoryBibleCardKey;
  title: string;
}> = [
  { key: 'oneSentence', title: '一句话故事' },
  { key: 'sellingPoints', title: '核心卖点' },
  { key: 'protagonist', title: '主角' },
  { key: 'goldenFinger', title: '金手指' },
  { key: 'worldIronLaws', title: '世界铁律' },
  { key: 'mainPlot', title: '主线' },
  { key: 'subplots', title: '支线' },
  { key: 'ending', title: '结局方向' },
  { key: 'readerPromise', title: '读者承诺' },
];

export const storyBibleCardSchema = z.object({
  key: storyBibleCardKeySchema,
  summary: z.string().trim().max(2_000),
  details: z.string().trim().max(12_000),
});

export const storyBibleSaveSchema = z
  .object({
    cards: z.array(storyBibleCardSchema).max(STORY_BIBLE_CARD_DEFINITIONS.length).optional(),
    oneSentenceStory: z.string().trim().min(1).max(2_000).optional(),
    protagonist: z.string().trim().min(1).max(2_000).optional(),
    worldIronLaw: z.string().trim().min(1).max(2_000).optional(),
    confirmLockedChange: z.boolean().optional(),
    changeReason: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((value, context) => {
    if (
      !value.cards &&
      value.oneSentenceStory === undefined &&
      value.protagonist === undefined &&
      value.worldIronLaw === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cards'],
        message: 'Add at least one story bible card',
      });
      return;
    }

    const keys = new Set<string>();
    for (const [index, card] of (value.cards ?? []).entries()) {
      if (keys.has(card.key)) {
        context.addIssue({
          code: 'custom',
          path: ['cards', index, 'key'],
          message: `Duplicate story bible card: ${card.key}`,
        });
      }
      keys.add(card.key);
    }

    const hasContent =
      (value.cards ?? []).some((card) => card.summary.length > 0 || card.details.length > 0) ||
      Boolean(value.oneSentenceStory) ||
      Boolean(value.protagonist) ||
      Boolean(value.worldIronLaw);
    if (!hasContent) {
      context.addIssue({
        code: 'custom',
        path: ['cards'],
        message: 'Add content to at least one story bible card',
      });
    }

    if (value.confirmLockedChange && !value.changeReason) {
      context.addIssue({
        code: 'custom',
        path: ['changeReason'],
        message: 'Explain why the locked story bible needs to change',
      });
    }
  });

export type StoryBibleCard = z.infer<typeof storyBibleCardSchema> & { title: string };
export type StoryBibleCardInput = z.infer<typeof storyBibleCardSchema>;
export type StoryBibleSaveInput = z.infer<typeof storyBibleSaveSchema>;

const LEGACY_CARD_KEYS = {
  oneSentenceStory: 'oneSentence',
  protagonist: 'protagonist',
  worldIronLaw: 'worldIronLaws',
} as const satisfies Record<string, StoryBibleCardKey>;

type StoryBibleCardSource = Omit<Partial<StoryBibleCardInput>, 'key'> & { key: string };

function isStoryBibleCardKey(value: string): value is StoryBibleCardKey {
  return STORY_BIBLE_CARD_DEFINITIONS.some((card) => card.key === value);
}

export function emptyStoryBibleCards(): StoryBibleCard[] {
  return STORY_BIBLE_CARD_DEFINITIONS.map(({ key, title }) => ({
    key,
    title,
    summary: '',
    details: '',
  }));
}

export function normalizeStoryBibleCards(
  cards: StoryBibleCardSource[] | null | undefined,
  legacy: {
    oneSentenceStory?: string | null;
    protagonist?: string | null;
    worldIronLaw?: string | null;
  } = {},
): StoryBibleCard[] {
  const byKey = new Map<StoryBibleCardKey, { summary: string; details: string }>();
  for (const card of cards ?? []) {
    if (!isStoryBibleCardKey(card.key)) {
      continue;
    }
    const existing = byKey.get(card.key);
    byKey.set(card.key, {
      summary: card.summary ?? existing?.summary ?? '',
      details: card.details ?? existing?.details ?? '',
    });
  }

  for (const [legacyField, cardKey] of Object.entries(LEGACY_CARD_KEYS) as Array<
    [keyof typeof LEGACY_CARD_KEYS, StoryBibleCardKey]
  >) {
    const value = legacy[legacyField];
    if (value === undefined || value === null) {
      continue;
    }
    const existing = byKey.get(cardKey);
    byKey.set(cardKey, {
      summary: value,
      details: existing?.details ?? '',
    });
  }

  return STORY_BIBLE_CARD_DEFINITIONS.map(({ key, title }) => ({
    key,
    title,
    summary: byKey.get(key)?.summary ?? '',
    details: byKey.get(key)?.details ?? '',
  }));
}

export function mergeStoryBibleCards(
  existing: StoryBibleCard[],
  input: StoryBibleSaveInput,
): StoryBibleCard[] {
  const byKey = new Map(
    existing.map((card) => [card.key, { summary: card.summary, details: card.details }]),
  );

  for (const card of input.cards ?? []) {
    byKey.set(card.key, { summary: card.summary, details: card.details });
  }

  for (const [legacyField, cardKey] of Object.entries(LEGACY_CARD_KEYS) as Array<
    [keyof typeof LEGACY_CARD_KEYS, StoryBibleCardKey]
  >) {
    const value = input[legacyField];
    if (value === undefined) {
      continue;
    }
    const current = byKey.get(cardKey);
    byKey.set(cardKey, {
      summary: value,
      details: current?.details ?? '',
    });
  }

  return STORY_BIBLE_CARD_DEFINITIONS.map(({ key, title }) => ({
    key,
    title,
    summary: byKey.get(key)?.summary ?? '',
    details: byKey.get(key)?.details ?? '',
  }));
}

export function storyBibleCompletion(cards: StoryBibleCard[]) {
  const missing = cards.filter((card) => !card.summary.trim());
  return {
    complete: missing.length === 0,
    filledCards: cards.length - missing.length,
    totalCards: cards.length,
    missingCardTitles: missing.map((card) => card.title),
  };
}

export function storyBibleLegacyFields(cards: StoryBibleCard[]) {
  const byKey = new Map(cards.map((card) => [card.key, card]));
  return {
    oneSentenceStory: byKey.get('oneSentence')?.summary ?? '',
    protagonist: byKey.get('protagonist')?.summary ?? '',
    worldIronLaw: byKey.get('worldIronLaws')?.summary ?? '',
  };
}

export const chapterOutlineSchema = z.object({
  chapterGoal: z.string().trim().min(1).max(1_000),
  pov: z.string().trim().min(1).max(120),
  sceneBeats: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  chapterEndHook: z.string().trim().min(1).max(500),
});

export const chapterNumberSchema = z.coerce.number().int().min(1).max(100_000);

export type ChapterOutlineInput = z.infer<typeof chapterOutlineSchema>;
