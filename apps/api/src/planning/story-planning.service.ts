import { HttpStatus, Injectable } from '@nestjs/common';
import type { ChapterOutlineInput, StoryBibleInput } from '@novel/contracts';
import {
  chapterOutlines,
  storyBibles,
  workBranches,
  works,
  type ChapterOutlineRow,
  type StoryBibleRow,
} from '@novel/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { storyPlanningError } from './story-planning.errors';

type StoryBibleResponse = {
  id: string | null;
  workId: string;
  branchId: string;
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
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
  createdAt: string | null;
  updatedAt: string | null;
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
    input: StoryBibleInput,
  ): Promise<StoryBibleResponse> {
    await this.requireBranch(userId, workId, branchId);
    const now = new Date();
    const [row] = await this.database.db
      .insert(storyBibles)
      .values({
        workId,
        branchId,
        oneSentenceStory: input.oneSentenceStory,
        protagonist: input.protagonist,
        worldIronLaw: input.worldIronLaw,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [storyBibles.workId, storyBibles.branchId],
        set: {
          oneSentenceStory: input.oneSentenceStory,
          protagonist: input.protagonist,
          worldIronLaw: input.worldIronLaw,
          updatedAt: now,
        },
      })
      .returning();

    await this.database.db
      .update(works)
      .set({ updatedAt: now })
      .where(and(eq(works.id, workId), eq(works.userId, userId)));

    return this.toStoryBibleResponse(row);
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
    const [row] = await this.database.db
      .insert(chapterOutlines)
      .values({
        workId,
        branchId,
        chapterNumber,
        chapterGoal: input.chapterGoal,
        pov: input.pov,
        sceneBeats: input.sceneBeats,
        chapterEndHook: input.chapterEndHook,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [chapterOutlines.workId, chapterOutlines.branchId, chapterOutlines.chapterNumber],
        set: {
          chapterGoal: input.chapterGoal,
          pov: input.pov,
          sceneBeats: input.sceneBeats,
          chapterEndHook: input.chapterEndHook,
          updatedAt: now,
        },
      })
      .returning();

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

  private toStoryBibleResponse(row: StoryBibleRow): StoryBibleResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      oneSentenceStory: row.oneSentenceStory,
      protagonist: row.protagonist,
      worldIronLaw: row.worldIronLaw,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toChapterOutlineResponse(row: ChapterOutlineRow): ChapterOutlineResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      chapterNumber: row.chapterNumber,
      chapterGoal: row.chapterGoal,
      pov: row.pov,
      sceneBeats: row.sceneBeats,
      chapterEndHook: row.chapterEndHook,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
