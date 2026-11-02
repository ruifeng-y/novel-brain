import { HttpStatus, Injectable } from '@nestjs/common';
import {
  STORY_ARC_STATUS_LABELS,
  STORY_FORESHADOW_IMPORTANCE_LABELS,
  STORY_FORESHADOW_STATUS_LABELS,
  STORY_THREAD_STATUS_LABELS,
  STORY_THREAD_TYPE_LABELS,
  type CreateCharacterArcInput,
  type CreateForeshadowInput,
  type CreateStoryThreadInput,
  type UpdateCharacterArcInput,
  type UpdateForeshadowInput,
  type UpdateStoryThreadInput,
} from '@novel/contracts';
import {
  characterArcs,
  chapters,
  entities,
  foreshadows,
  storyThreads,
  workBranches,
  works,
  type CharacterArcRow,
  type ForeshadowRow,
  type StoryThreadRow,
} from '@novel/db';
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { storyPlanningError } from './story-planning.errors';

type StoryThreadResponse = {
  id: string;
  workId: string;
  branchId: string;
  name: string;
  type: StoryThreadRow['type'];
  typeLabel: string;
  summary: string;
  stakes: string;
  participantIds: string[];
  participants: Array<{ id: string; name: string }>;
  plannedPayoffChapter: number | null;
  status: StoryThreadRow['status'];
  statusLabel: string;
  milestones: StoryThreadRow['milestones'];
  tensionCurve: StoryThreadRow['tensionCurve'];
  createdAt: string;
  updatedAt: string;
};

type StoryLedgerResponse = {
  threads: StoryThreadResponse[];
  foreshadows: ForeshadowResponse[];
  characterArcs: CharacterArcResponse[];
  characters: Array<{ id: string; name: string }>;
  checks: StoryLedgerChecks;
};

type StoryLedgerCheck = {
  id: string;
  kind: 'overdue_foreshadow' | 'unclosed_thread' | 'motivation_break';
  kindLabel: string;
  severity: 'warning';
  severityLabel: string;
  title: string;
  detail: string;
  targetType: 'foreshadow' | 'thread' | 'character';
  targetId: string;
  chapterNumber: number | null;
};

type StoryLedgerChecks = {
  writtenThroughChapter: number | null;
  items: StoryLedgerCheck[];
  summary: {
    overdueForeshadows: number;
    unclosedThreads: number;
    motivationBreaks: number;
  };
};

type CharacterArcResponse = {
  id: string;
  workId: string;
  branchId: string;
  characterId: string;
  character: { id: string; name: string };
  startState: string;
  desire: string;
  fear: string;
  lie: string;
  truth: string;
  turn: string;
  endState: string;
  status: CharacterArcRow['status'];
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
};

type ForeshadowResponse = {
  id: string;
  workId: string;
  branchId: string;
  title: string;
  description: string;
  plantChapter: number | null;
  plannedPayoffChapter: number | null;
  importance: ForeshadowRow['importance'];
  importanceLabel: string;
  status: ForeshadowRow['status'];
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class StoryLedgerService {
  constructor(private readonly database: DatabaseService) {}

  async getLedger(userId: string, workId: string, branchId: string): Promise<StoryLedgerResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [threadRows, foreshadowRows, arcRows, characterRows] = await Promise.all([
      this.database.db
        .select()
        .from(storyThreads)
        .where(and(eq(storyThreads.workId, workId), eq(storyThreads.branchId, branchId)))
        .orderBy(asc(storyThreads.createdAt)),
      this.database.db
        .select()
        .from(foreshadows)
        .where(and(eq(foreshadows.workId, workId), eq(foreshadows.branchId, branchId)))
        .orderBy(asc(foreshadows.setupChapter), asc(foreshadows.createdAt)),
      this.database.db
        .select()
        .from(characterArcs)
        .where(and(eq(characterArcs.workId, workId), eq(characterArcs.branchId, branchId)))
        .orderBy(asc(characterArcs.createdAt)),
      this.listCharacters(workId, branchId),
    ]);

    return {
      threads: await this.threadResponses(threadRows),
      foreshadows: foreshadowRows.map((row) => this.toForeshadowResponse(row)),
      characterArcs: arcRows.map((row) =>
        this.toCharacterArcResponse(
          row,
          characterRows.find((character) => character.id === row.characterId),
        ),
      ),
      characters: characterRows,
      checks: await this.getChecks(userId, workId, branchId),
    };
  }

  async getChecks(userId: string, workId: string, branchId: string): Promise<StoryLedgerChecks> {
    await this.requireBranch(userId, workId, branchId);
    const [writtenChapter, activeThreadRows, plantedForeshadowRows, activeArcRows, characterRows] =
      await Promise.all([
        this.database.db
          .select({ value: max(chapters.chapterNumber) })
          .from(chapters)
          .where(
            and(
              eq(chapters.workId, workId),
              eq(chapters.branchId, branchId),
              inArray(chapters.status, ['writing', 'review', 'locked', 'published']),
            ),
          ),
        this.database.db
          .select()
          .from(storyThreads)
          .where(
            and(
              eq(storyThreads.workId, workId),
              eq(storyThreads.branchId, branchId),
              eq(storyThreads.status, 'active'),
            ),
          ),
        this.database.db
          .select()
          .from(foreshadows)
          .where(
            and(
              eq(foreshadows.workId, workId),
              eq(foreshadows.branchId, branchId),
              eq(foreshadows.status, 'planted'),
            ),
          ),
        this.database.db
          .select()
          .from(characterArcs)
          .where(
            and(
              eq(characterArcs.workId, workId),
              eq(characterArcs.branchId, branchId),
              eq(characterArcs.status, 'active'),
            ),
          ),
        this.listCharacters(workId, branchId),
      ]);

    const writtenThroughChapter = writtenChapter[0]?.value ? Number(writtenChapter[0].value) : null;
    const items: StoryLedgerCheck[] = [];

    if (writtenThroughChapter !== null) {
      for (const foreshadow of plantedForeshadowRows) {
        if (
          foreshadow.plannedPayoffChapter !== null &&
          foreshadow.plannedPayoffChapter <= writtenThroughChapter
        ) {
          items.push({
            id: `overdue-foreshadow-${foreshadow.id}`,
            kind: 'overdue_foreshadow',
            kindLabel: '过期伏笔',
            severity: 'warning',
            severityLabel: '需要处理',
            title: foreshadow.title,
            detail: `计划在第 ${foreshadow.plannedPayoffChapter} 章回收，当前已经写到第 ${writtenThroughChapter} 章。`,
            targetType: 'foreshadow',
            targetId: foreshadow.id,
            chapterNumber: foreshadow.plannedPayoffChapter,
          });
        }
      }

      for (const thread of activeThreadRows) {
        if (
          thread.plannedPayoffChapter !== null &&
          thread.plannedPayoffChapter <= writtenThroughChapter
        ) {
          items.push({
            id: `unclosed-thread-${thread.id}`,
            kind: 'unclosed_thread',
            kindLabel: '未收束剧情线',
            severity: 'warning',
            severityLabel: '需要处理',
            title: thread.name,
            detail: `计划在第 ${thread.plannedPayoffChapter} 章收束，当前已经写到第 ${writtenThroughChapter} 章，但这条线仍在推进。`,
            targetType: 'thread',
            targetId: thread.id,
            chapterNumber: thread.plannedPayoffChapter,
          });
        }
      }
    }

    const arcsByCharacter = new Map(activeArcRows.map((arc) => [arc.characterId, arc]));
    for (const arc of activeArcRows) {
      const character = characterRows.find((candidate) => candidate.id === arc.characterId);
      const missingLabels = [
        ['startState', '起点'],
        ['desire', '欲望'],
        ['fear', '恐惧'],
        ['lie', '谎言'],
        ['truth', '真相'],
        ['turn', '转折'],
        ['endState', '终点'],
      ]
        .filter(([field]) => !arc[field as keyof CharacterArcRow]?.toString().trim())
        .map(([, label]) => label);
      if (missingLabels.length > 0) {
        items.push({
          id: `motivation-break-${arc.id}`,
          kind: 'motivation_break',
          kindLabel: '动机断点',
          severity: 'warning',
          severityLabel: '需要处理',
          title: character?.name ?? '未知人物',
          detail: `人物弧缺少：${missingLabels.join('、')}。补全后动机链才完整。`,
          targetType: 'character',
          targetId: arc.characterId,
          chapterNumber: null,
        });
      }
    }

    const missingArcThreads = new Map<string, string[]>();
    for (const thread of activeThreadRows) {
      for (const participantId of thread.participantIds) {
        if (
          characterRows.some((character) => character.id === participantId) &&
          !arcsByCharacter.has(participantId)
        ) {
          const threadNames = missingArcThreads.get(participantId) ?? [];
          threadNames.push(thread.name);
          missingArcThreads.set(participantId, threadNames);
        }
      }
    }
    for (const [characterId, threadNames] of missingArcThreads) {
      const character = characterRows.find((candidate) => candidate.id === characterId);
      items.push({
        id: `motivation-break-${characterId}`,
        kind: 'motivation_break',
        kindLabel: '动机断点',
        severity: 'warning',
        severityLabel: '需要处理',
        title: character?.name ?? '未知人物',
        detail: `参与了「${threadNames.join('」「')}」，但还没有人物弧。`,
        targetType: 'character',
        targetId: characterId,
        chapterNumber: null,
      });
    }

    return {
      writtenThroughChapter,
      items,
      summary: {
        overdueForeshadows: items.filter((item) => item.kind === 'overdue_foreshadow').length,
        unclosedThreads: items.filter((item) => item.kind === 'unclosed_thread').length,
        motivationBreaks: items.filter((item) => item.kind === 'motivation_break').length,
      },
    };
  }

  async createForeshadow(
    userId: string,
    workId: string,
    branchId: string,
    input: CreateForeshadowInput,
  ): Promise<ForeshadowResponse> {
    await this.requireBranch(userId, workId, branchId);
    const now = new Date();
    const [created] = await this.database.db
      .insert(foreshadows)
      .values({
        workId,
        branchId,
        title: input.title,
        description: input.description,
        setupChapter: input.plantChapter,
        plannedPayoffChapter: input.plannedPayoffChapter,
        importance: input.importance,
        status: input.status,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.touchWork(userId, workId, now);
    return this.toForeshadowResponse(created);
  }

  async updateForeshadow(
    userId: string,
    workId: string,
    branchId: string,
    foreshadowId: string,
    input: UpdateForeshadowInput,
  ): Promise<ForeshadowResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [existing] = await this.database.db
      .select()
      .from(foreshadows)
      .where(
        and(
          eq(foreshadows.id, foreshadowId),
          eq(foreshadows.workId, workId),
          eq(foreshadows.branchId, branchId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw storyPlanningError(
        HttpStatus.NOT_FOUND,
        'FORESHADOW_NOT_FOUND',
        'Foreshadow not found',
      );
    }

    const now = new Date();
    const [updated] = await this.database.db
      .update(foreshadows)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.plantChapter === undefined ? {} : { setupChapter: input.plantChapter }),
        ...(input.plannedPayoffChapter === undefined
          ? {}
          : { plannedPayoffChapter: input.plannedPayoffChapter }),
        ...(input.importance === undefined ? {} : { importance: input.importance }),
        ...(input.status === undefined ? {} : { status: input.status }),
        updatedAt: now,
      })
      .where(eq(foreshadows.id, existing.id))
      .returning();
    await this.touchWork(userId, workId, now);
    return this.toForeshadowResponse(updated);
  }

  async saveCharacterArc(
    userId: string,
    workId: string,
    branchId: string,
    input: CreateCharacterArcInput,
  ): Promise<CharacterArcResponse> {
    await this.requireBranch(userId, workId, branchId);
    const character = await this.requireCharacter(workId, branchId, input.characterId);
    const now = new Date();
    const [saved] = await this.database.db
      .insert(characterArcs)
      .values({
        workId,
        branchId,
        ...input,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [characterArcs.workId, characterArcs.branchId, characterArcs.characterId],
        set: {
          startState: input.startState,
          desire: input.desire,
          fear: input.fear,
          lie: input.lie,
          truth: input.truth,
          turn: input.turn,
          endState: input.endState,
          status: input.status,
          updatedAt: now,
        },
      })
      .returning();
    await this.touchWork(userId, workId, now);
    return this.toCharacterArcResponse(saved, { id: character.id, name: character.name });
  }

  async updateCharacterArc(
    userId: string,
    workId: string,
    branchId: string,
    arcId: string,
    input: UpdateCharacterArcInput,
  ): Promise<CharacterArcResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [existing] = await this.database.db
      .select()
      .from(characterArcs)
      .where(
        and(
          eq(characterArcs.id, arcId),
          eq(characterArcs.workId, workId),
          eq(characterArcs.branchId, branchId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw storyPlanningError(
        HttpStatus.NOT_FOUND,
        'CHARACTER_ARC_NOT_FOUND',
        'Character arc not found',
      );
    }
    const characterId = input.characterId ?? existing.characterId;
    const character = await this.requireCharacter(workId, branchId, characterId);
    const now = new Date();
    const [updated] = await this.database.db
      .update(characterArcs)
      .set({
        ...(input.characterId === undefined ? {} : { characterId: input.characterId }),
        ...(input.startState === undefined ? {} : { startState: input.startState }),
        ...(input.desire === undefined ? {} : { desire: input.desire }),
        ...(input.fear === undefined ? {} : { fear: input.fear }),
        ...(input.lie === undefined ? {} : { lie: input.lie }),
        ...(input.truth === undefined ? {} : { truth: input.truth }),
        ...(input.turn === undefined ? {} : { turn: input.turn }),
        ...(input.endState === undefined ? {} : { endState: input.endState }),
        ...(input.status === undefined ? {} : { status: input.status }),
        updatedAt: now,
      })
      .where(eq(characterArcs.id, existing.id))
      .returning();
    await this.touchWork(userId, workId, now);
    return this.toCharacterArcResponse(updated, { id: character.id, name: character.name });
  }

  async createThread(
    userId: string,
    workId: string,
    branchId: string,
    input: CreateStoryThreadInput,
  ): Promise<StoryThreadResponse> {
    await this.requireBranch(userId, workId, branchId);
    await this.requireParticipants(workId, branchId, input.participantIds);
    const now = new Date();
    const [created] = await this.database.db
      .insert(storyThreads)
      .values({
        workId,
        branchId,
        name: input.name,
        type: input.type,
        summary: input.summary,
        stakes: input.stakes,
        participantIds: input.participantIds,
        plannedPayoffChapter: input.plannedPayoffChapter,
        status: input.status,
        milestones: [...input.milestones].sort(
          (left, right) => left.chapterNumber - right.chapterNumber,
        ),
        tensionCurve: [...input.tensionCurve].sort(
          (left, right) => left.chapterNumber - right.chapterNumber,
        ),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.database.db
      .update(works)
      .set({ updatedAt: now })
      .where(and(eq(works.id, workId), eq(works.userId, userId)));
    return this.toThreadResponse(created, await this.participantMap(created.participantIds));
  }

  async updateThread(
    userId: string,
    workId: string,
    branchId: string,
    threadId: string,
    input: UpdateStoryThreadInput,
  ): Promise<StoryThreadResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [existing] = await this.database.db
      .select()
      .from(storyThreads)
      .where(
        and(
          eq(storyThreads.id, threadId),
          eq(storyThreads.workId, workId),
          eq(storyThreads.branchId, branchId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'THREAD_NOT_FOUND', 'Plot line not found');
    }
    if (input.participantIds) {
      await this.requireParticipants(workId, branchId, input.participantIds);
    }

    const now = new Date();
    const [updated] = await this.database.db
      .update(storyThreads)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.stakes === undefined ? {} : { stakes: input.stakes }),
        ...(input.participantIds === undefined ? {} : { participantIds: input.participantIds }),
        ...(input.plannedPayoffChapter === undefined
          ? {}
          : { plannedPayoffChapter: input.plannedPayoffChapter }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.milestones === undefined
          ? {}
          : {
              milestones: [...input.milestones].sort(
                (left, right) => left.chapterNumber - right.chapterNumber,
              ),
            }),
        ...(input.tensionCurve === undefined
          ? {}
          : {
              tensionCurve: [...input.tensionCurve].sort(
                (left, right) => left.chapterNumber - right.chapterNumber,
              ),
            }),
        updatedAt: now,
      })
      .where(eq(storyThreads.id, existing.id))
      .returning();
    await this.touchWork(userId, workId, now);
    return this.toThreadResponse(updated, await this.participantMap(updated.participantIds));
  }

  async deleteThread(
    userId: string,
    workId: string,
    branchId: string,
    threadId: string,
  ): Promise<void> {
    await this.requireBranch(userId, workId, branchId);
    const [deleted] = await this.database.db
      .delete(storyThreads)
      .where(
        and(
          eq(storyThreads.id, threadId),
          eq(storyThreads.workId, workId),
          eq(storyThreads.branchId, branchId),
        ),
      )
      .returning({ id: storyThreads.id });
    if (!deleted) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'THREAD_NOT_FOUND', 'Plot line not found');
    }
    await this.touchWork(userId, workId, new Date());
  }

  private async listCharacters(
    workId: string,
    branchId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.database.db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(
        and(
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          eq(entities.type, 'character'),
          isNull(entities.deletedAt),
        ),
      )
      .orderBy(asc(entities.name));
  }

  private async requireParticipants(
    workId: string,
    branchId: string,
    participantIds: string[],
  ): Promise<void> {
    if (participantIds.length === 0) {
      return;
    }
    const rows = await this.database.db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          inArray(entities.id, participantIds),
          isNull(entities.deletedAt),
        ),
      );
    if (rows.length !== participantIds.length) {
      throw storyPlanningError(
        HttpStatus.BAD_REQUEST,
        'PARTICIPANT_NOT_FOUND',
        'Choose participants from this work branch',
      );
    }
  }

  private async requireCharacter(
    workId: string,
    branchId: string,
    characterId: string,
  ): Promise<{ id: string; name: string }> {
    const [character] = await this.database.db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(
        and(
          eq(entities.id, characterId),
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          eq(entities.type, 'character'),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    if (!character) {
      throw storyPlanningError(HttpStatus.NOT_FOUND, 'CHARACTER_NOT_FOUND', 'Character not found');
    }
    return character;
  }

  private async participantMap(participantIds: string[]) {
    if (participantIds.length === 0) {
      return new Map<string, string>();
    }
    const rows = await this.database.db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(inArray(entities.id, participantIds));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async touchWork(userId: string, workId: string, now: Date): Promise<void> {
    await this.database.db
      .update(works)
      .set({ updatedAt: now })
      .where(and(eq(works.id, workId), eq(works.userId, userId)));
  }

  private async threadResponses(rows: StoryThreadRow[]): Promise<StoryThreadResponse[]> {
    const participantIds = [...new Set(rows.flatMap((row) => row.participantIds))];
    const participants = await this.participantMap(participantIds);
    return rows.map((row) => this.toThreadResponse(row, participants));
  }

  private toThreadResponse(
    row: StoryThreadRow,
    participants: Map<string, string>,
  ): StoryThreadResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      name: row.name,
      type: row.type,
      typeLabel: STORY_THREAD_TYPE_LABELS[row.type],
      summary: row.summary,
      stakes: row.stakes,
      participantIds: row.participantIds,
      participants: row.participantIds.map((id) => ({
        id,
        name: participants.get(id) ?? '未知参与者',
      })),
      plannedPayoffChapter: row.plannedPayoffChapter,
      status: row.status,
      statusLabel: STORY_THREAD_STATUS_LABELS[row.status],
      milestones: row.milestones,
      tensionCurve: row.tensionCurve,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toForeshadowResponse(row: ForeshadowRow): ForeshadowResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      title: row.title,
      description: row.description,
      plantChapter: row.setupChapter,
      plannedPayoffChapter: row.plannedPayoffChapter,
      importance: row.importance,
      importanceLabel: STORY_FORESHADOW_IMPORTANCE_LABELS[row.importance],
      status: row.status,
      statusLabel: STORY_FORESHADOW_STATUS_LABELS[row.status],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCharacterArcResponse(
    row: CharacterArcRow,
    character: { id: string; name: string } | undefined,
  ): CharacterArcResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      characterId: row.characterId,
      character: character ?? { id: row.characterId, name: '未知人物' },
      startState: row.startState,
      desire: row.desire,
      fear: row.fear,
      lie: row.lie,
      truth: row.truth,
      turn: row.turn,
      endState: row.endState,
      status: row.status,
      statusLabel: STORY_ARC_STATUS_LABELS[row.status],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
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
}
