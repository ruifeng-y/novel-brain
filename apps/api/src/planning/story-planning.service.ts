import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CONTINUITY_CATEGORY_LABELS,
  CONTINUITY_SEVERITY_LABELS,
  STORY_BIBLE_CARD_DEFINITIONS,
  emptyStoryBibleCards,
  mergeStoryBibleCards,
  normalizeStoryBibleCards,
  storyBibleCompletion,
  storyBibleLegacyFields,
  type ChapterOutlineInput,
  type StoryBibleCard,
  type StoryBibleSaveInput,
} from '@novel/contracts';
import {
  annotations,
  chapterOutlines,
  chapters,
  foreshadows,
  storyBibleRevisions,
  storyBibles,
  users,
  workBranches,
  works,
  type ChapterOutlineRow,
  type StoryBibleRevisionRow,
  type StoryBibleRow,
} from '@novel/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { storyPlanningError } from './story-planning.errors';

type StoryBibleResponse = {
  id: string | null;
  workId: string;
  branchId: string;
  cards: StoryBibleCard[];
  completion: ReturnType<typeof storyBibleCompletion>;
  locked: boolean;
  lockedAt: string | null;
  version: number;
  oneSentenceStory: string;
  protagonist: string;
  worldIronLaw: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type ChapterOutlineResponse = {
  id: string | null;
  workId: string;
  branchId: string;
  chapterNumber: number;
  title: string;
  summary: string;
  details: string;
  locked: boolean;
  version: number;
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type StoryBibleInsights = {
  continuityReminders: Array<{
    id: string;
    chapterNumber: number;
    categoryLabel: string;
    severityLabel: string;
    message: string;
    suggestion: string;
  }>;
  unresolvedForeshadows: Array<{
    id: string;
    title: string;
    description: string;
    setupChapter: number | null;
    plannedPayoffChapter: number | null;
    importanceLabel: string;
  }>;
  recentChanges: Array<{
    id: string;
    actionLabel: string;
    reason: string;
    changedCardTitles: string[];
    authorName: string;
    createdAt: string;
  }>;
};

@Injectable()
export class StoryPlanningService {
  constructor(private readonly database: DatabaseService) {}

  async getStoryBible(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<StoryBibleResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [row] = await this.database.db
      .select()
      .from(storyBibles)
      .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)))
      .limit(1);

    return row
      ? this.toStoryBibleResponse(row)
      : {
          id: null,
          workId,
          branchId,
          cards: emptyStoryBibleCards(),
          completion: storyBibleCompletion(emptyStoryBibleCards()),
          locked: false,
          lockedAt: null,
          version: 0,
          oneSentenceStory: '',
          protagonist: '',
          worldIronLaw: '',
          createdAt: null,
          updatedAt: null,
        };
  }

  async saveStoryBible(
    userId: string,
    workId: string,
    branchId: string,
    input: StoryBibleSaveInput,
  ): Promise<StoryBibleResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.database.db.transaction(async (tx) => {
      await this.lockStoryBibleRow(tx, workId, branchId);
      const [existing] = await tx
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)))
        .limit(1);
      const existingCards = existing
        ? normalizeStoryBibleCards(existing.cards, existing)
        : emptyStoryBibleCards();
      const cards = mergeStoryBibleCards(existingCards, input);
      const changedCards = this.changedStoryBibleCardKeys(existingCards, cards);
      if (existing && changedCards.length === 0) {
        return existing;
      }
      if (existing?.lockedAt && !input.confirmLockedChange) {
        throw storyPlanningError(
          HttpStatus.CONFLICT,
          'STORY_BIBLE_LOCKED',
          'Confirm the change and record a reason before editing the locked story bible',
          {
            requiresConfirmation: true,
            reasonRequired: true,
            version: existing.version,
          },
        );
      }

      const legacy = storyBibleLegacyFields(cards);
      const now = new Date();
      const lockedChange = Boolean(existing?.lockedAt);
      const [saved] = await tx
        .insert(storyBibles)
        .values({
          workId,
          branchId,
          ...legacy,
          cards,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [storyBibles.workId, storyBibles.branchId],
          set: {
            ...legacy,
            cards,
            version: (existing?.version ?? 0) + 1,
            updatedAt: now,
          },
        })
        .returning();

      await tx.insert(storyBibleRevisions).values({
        workId,
        branchId,
        storyBibleId: saved.id,
        userId,
        kind: lockedChange ? 'locked_change' : 'saved',
        reason: input.changeReason ?? (lockedChange ? '确认修改锁定的故事圣经' : '保存故事圣经'),
        changedCards,
        beforeCards: this.storyBibleCardValues(existingCards),
        afterCards: this.storyBibleCardValues(cards),
        createdAt: now,
      });

      await tx
        .update(works)
        .set({ updatedAt: now })
        .where(and(eq(works.id, workId), eq(works.userId, userId)));

      return saved;
    });

    return this.toStoryBibleResponse(row);
  }

  async lockStoryBible(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<StoryBibleResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.database.db.transaction(async (tx) => {
      await this.lockStoryBibleRow(tx, workId, branchId);
      const [existing] = await tx
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)))
        .limit(1);
      if (!existing) {
        throw storyPlanningError(
          HttpStatus.BAD_REQUEST,
          'STORY_BIBLE_INCOMPLETE',
          'Complete every story bible card before locking it',
          {
            missingCardTitles: emptyStoryBibleCards().map((card) => card.title),
          },
        );
      }

      const cards = normalizeStoryBibleCards(existing.cards, existing);
      const completion = storyBibleCompletion(cards);
      if (!completion.complete) {
        throw storyPlanningError(
          HttpStatus.BAD_REQUEST,
          'STORY_BIBLE_INCOMPLETE',
          'Complete every story bible card before locking it',
          completion,
        );
      }
      if (existing.lockedAt) {
        return existing;
      }

      const now = new Date();
      const [locked] = await tx
        .update(storyBibles)
        .set({
          lockedAt: now,
          lockedBy: userId,
          version: existing.version + 1,
          updatedAt: now,
        })
        .where(eq(storyBibles.id, existing.id))
        .returning();

      await tx.insert(storyBibleRevisions).values({
        workId,
        branchId,
        storyBibleId: existing.id,
        userId,
        kind: 'locked',
        reason: '锁定故事圣经',
        changedCards: [],
        beforeCards: this.storyBibleCardValues(cards),
        afterCards: this.storyBibleCardValues(cards),
        createdAt: now,
      });
      await tx
        .update(works)
        .set({ updatedAt: now })
        .where(and(eq(works.id, workId), eq(works.userId, userId)));

      return locked;
    });

    return this.toStoryBibleResponse(row);
  }

  async getStoryBibleInsights(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<StoryBibleInsights> {
    await this.requireBranch(userId, workId, branchId);
    const [continuityRows, foreshadowRows, recentRows] = await Promise.all([
      this.database.db
        .select({
          reminder: annotations,
          chapterNumber: chapters.chapterNumber,
        })
        .from(annotations)
        .innerJoin(chapters, eq(chapters.id, annotations.chapterId))
        .where(
          and(
            eq(annotations.workId, workId),
            eq(annotations.branchId, branchId),
            eq(annotations.status, 'open'),
          ),
        )
        .orderBy(desc(annotations.createdAt))
        .limit(8),
      this.database.db
        .select()
        .from(foreshadows)
        .where(
          and(
            eq(foreshadows.workId, workId),
            eq(foreshadows.branchId, branchId),
            eq(foreshadows.status, 'planted'),
          ),
        )
        .orderBy(asc(foreshadows.importance), asc(foreshadows.plannedPayoffChapter))
        .limit(8),
      this.database.db
        .select({
          revision: storyBibleRevisions,
          authorName: users.displayName,
        })
        .from(storyBibleRevisions)
        .innerJoin(users, eq(users.id, storyBibleRevisions.userId))
        .where(
          and(eq(storyBibleRevisions.workId, workId), eq(storyBibleRevisions.branchId, branchId)),
        )
        .orderBy(desc(storyBibleRevisions.createdAt))
        .limit(8),
    ]);

    return {
      continuityReminders: continuityRows.map(({ reminder, chapterNumber }) => ({
        id: reminder.id,
        chapterNumber,
        categoryLabel: CONTINUITY_CATEGORY_LABELS[reminder.category] ?? '连续性',
        severityLabel: CONTINUITY_SEVERITY_LABELS[reminder.severity] ?? '需要确认',
        message: reminder.message,
        suggestion: reminder.suggestion,
      })),
      unresolvedForeshadows: foreshadowRows.map((foreshadow) => ({
        id: foreshadow.id,
        title: foreshadow.title,
        description: foreshadow.description,
        setupChapter: foreshadow.setupChapter,
        plannedPayoffChapter: foreshadow.plannedPayoffChapter,
        importanceLabel: foreshadow.importance === 'must' ? '必须回收' : '可选回收',
      })),
      recentChanges: recentRows.map(({ revision, authorName }) => ({
        id: revision.id,
        actionLabel: this.storyBibleActionLabel(revision.kind),
        reason: revision.reason,
        changedCardTitles: this.storyBibleCardTitles(revision.changedCards),
        authorName,
        createdAt: revision.createdAt.toISOString(),
      })),
    };
  }

  async getChapterOutline(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
  ): Promise<ChapterOutlineResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [row] = await this.database.db
      .select()
      .from(chapterOutlines)
      .where(
        and(
          eq(chapterOutlines.workId, workId),
          eq(chapterOutlines.branchId, branchId),
          eq(chapterOutlines.chapterNumber, chapterNumber),
          eq(chapterOutlines.level, 'chapter'),
        ),
      )
      .limit(1);

    return row
      ? this.toChapterOutlineResponse(row)
      : {
          id: null,
          workId,
          branchId,
          chapterNumber,
          title: '',
          summary: '',
          details: '',
          locked: false,
          version: 0,
          chapterGoal: '',
          pov: '',
          sceneBeats: [],
          chapterEndHook: '',
          createdAt: null,
          updatedAt: null,
        };
  }

  async saveChapterOutline(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    input: ChapterOutlineInput,
  ): Promise<ChapterOutlineResponse> {
    await this.requireBranch(userId, workId, branchId);
    const now = new Date();
    const row = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${workId}:${branchId}:outline`}))`,
      );
      const [existing] = await tx
        .select()
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branchId),
            eq(chapterOutlines.chapterNumber, chapterNumber),
            eq(chapterOutlines.level, 'chapter'),
          ),
        )
        .limit(1);
      if (existing) {
        const [updated] = await tx
          .update(chapterOutlines)
          .set({
            title: `第 ${chapterNumber} 章`,
            summary: input.chapterGoal,
            chapterGoal: input.chapterGoal,
            pov: input.pov,
            sceneBeats: input.sceneBeats,
            chapterEndHook: input.chapterEndHook,
            version: existing.version + 1,
            updatedAt: now,
          })
          .where(eq(chapterOutlines.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await tx
        .insert(chapterOutlines)
        .values({
          workId,
          branchId,
          level: 'chapter',
          chapterNumber,
          title: `第 ${chapterNumber} 章`,
          summary: input.chapterGoal,
          details: '',
          orderIndex: chapterNumber - 1,
          chapterGoal: input.chapterGoal,
          pov: input.pov,
          sceneBeats: input.sceneBeats,
          chapterEndHook: input.chapterEndHook,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return created;
    });

    await this.database.db
      .update(works)
      .set({ updatedAt: now })
      .where(and(eq(works.id, workId), eq(works.userId, userId)));

    return this.toChapterOutlineResponse(row);
  }

  private async requireBranch(userId: string, workId: string, branchId: string): Promise<void> {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
  }

  private async lockStoryBibleRow(
    tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
    workId: string,
    branchId: string,
  ): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${workId}:${branchId}`}))`);
  }

  private changedStoryBibleCardKeys(before: StoryBibleCard[], after: StoryBibleCard[]): string[] {
    const beforeByKey = new Map(before.map((card) => [card.key, card]));
    return after
      .filter((card) => {
        const previous = beforeByKey.get(card.key);
        return !previous || previous.summary !== card.summary || previous.details !== card.details;
      })
      .map((card) => card.key);
  }

  private storyBibleCardValues(cards: StoryBibleCard[]) {
    return cards.map(({ key, summary, details }) => ({ key, summary, details }));
  }

  private storyBibleCardTitles(keys: string[]): string[] {
    const titles = new Map(STORY_BIBLE_CARD_DEFINITIONS.map((card) => [card.key, card.title]));
    return keys.map((key) => titles.get(key as StoryBibleCard['key']) ?? key);
  }

  private storyBibleActionLabel(kind: StoryBibleRevisionRow['kind']): string {
    if (kind === 'locked') {
      return '锁定故事圣经';
    }
    if (kind === 'locked_change') {
      return '确认后修改';
    }
    return '保存故事圣经';
  }

  private toStoryBibleResponse(row: StoryBibleRow): StoryBibleResponse {
    const cards = normalizeStoryBibleCards(row.cards, row);
    const legacy = storyBibleLegacyFields(cards);
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      cards,
      completion: storyBibleCompletion(cards),
      locked: row.lockedAt !== null,
      lockedAt: row.lockedAt?.toISOString() ?? null,
      version: row.version,
      ...legacy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toChapterOutlineResponse(row: ChapterOutlineRow): ChapterOutlineResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      chapterNumber: row.chapterNumber ?? 0,
      title: row.title,
      summary: row.summary,
      details: row.details,
      locked: row.lockedAt !== null,
      version: row.version,
      chapterGoal: row.chapterGoal,
      pov: row.pov,
      sceneBeats: row.sceneBeats,
      chapterEndHook: row.chapterEndHook,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
