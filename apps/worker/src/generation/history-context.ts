import {
  HISTORY_MAIN_TEMPLATE,
  HISTORY_SUBTYPE_LABELS,
  HISTORY_VARIANT_LABELS,
  type HistorySubtype,
  type HistoryVariant,
} from '@novel/contracts';
import { entities, works } from '@novel/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { DatabaseService } from '../database/database.service';

const HISTORY_SUBTYPES: HistorySubtype[] = [
  'dynasty',
  'bureaucracy',
  'military',
  'geography',
  'clan',
];

export type HistoryGenerationContext = {
  mainTemplate: string;
  variant: HistoryVariant;
  variantLabel: string;
  settings: Array<{
    id: string;
    name: string;
    subtype: HistorySubtype;
    subtypeLabel: string;
    summary: string;
    customFields: Record<string, unknown>;
  }>;
};

export async function loadHistoryGenerationContext(
  database: DatabaseService,
  workId: string,
  branchId: string,
): Promise<HistoryGenerationContext | null> {
  const [work] = await database.db
    .select({
      genrePack: works.genrePack,
      genreVariant: works.genreVariant,
    })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);
  if (!work || work.genrePack !== 'history') {
    return null;
  }

  const settingRows = await database.db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.workId, workId),
        eq(entities.branchId, branchId),
        inArray(entities.subtype, HISTORY_SUBTYPES),
        isNull(entities.deletedAt),
      ),
    )
    .orderBy(asc(entities.subtype), asc(entities.name));
  const variant = (work.genreVariant ?? 'alternate_ancient') as HistoryVariant;
  return {
    mainTemplate: HISTORY_MAIN_TEMPLATE,
    variant,
    variantLabel: HISTORY_VARIANT_LABELS[variant],
    settings: settingRows.map((entity) => ({
      id: entity.id,
      name: entity.name,
      subtype: entity.subtype as HistorySubtype,
      subtypeLabel: HISTORY_SUBTYPE_LABELS[entity.subtype as HistorySubtype],
      summary: entity.summary,
      customFields: entity.customFields,
    })),
  };
}
