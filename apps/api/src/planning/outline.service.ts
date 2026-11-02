import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AI_GATEWAY, AiGatewayError, type AiGateway } from '@novel/ai';
import {
  OUTLINE_LEVEL_LABELS,
  OUTLINE_PARENT_LEVEL,
  normalizeStoryBibleCards,
  outlineRegenerationSchema,
  storyBibleCompletion,
  type CreateOutlineNodeInput,
  type OutlineLevel,
  type OutlineReadinessQuery,
  type RegenerateOutlineNodeInput,
  type ReorderOutlineNodesInput,
  type UpdateOutlineNodeInput,
} from '@novel/contracts';
import {
  chapterOutlines,
  chapters,
  entities,
  facts,
  storyBibles,
  workBranches,
  works,
  type ChapterOutlineRow,
} from '@novel/db';
import { and, asc, count, eq, isNull, max, sql } from 'drizzle-orm';
import { ModelConfigService } from '../ai/model-config.service';
import { DatabaseService } from '../database/database.service';
import { storyPlanningError } from './story-planning.errors';

type OutlineNodeResponse = {
  id: string;
  workId: string;
  branchId: string;
  level: OutlineLevel;
  levelLabel: string;
  parentId: string | null;
  orderIndex: number;
  title: string;
  summary: string;
  details: string;
  chapterNumber: number | null;
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
  locked: boolean;
  lockedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ReadinessCheck = {
  ready: boolean;
  label: string;
  detail: string;
  missing: string[];
};

@Injectable()
export class OutlineService {
  constructor(
    private readonly database: DatabaseService,
    private readonly modelConfigs: ModelConfigService,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
  ) {}

  async list(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<{ items: OutlineNodeResponse[] }> {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select()
      .from(chapterOutlines)
      .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId)))
      .orderBy(
        asc(chapterOutlines.parentId),
        asc(chapterOutlines.orderIndex),
        asc(chapterOutlines.createdAt),
      );
    return { items: rows.map((row) => this.toResponse(row)) };
  }

  async get(
    userId: string,
    workId: string,
    branchId: string,
    outlineId: string,
  ): Promise<OutlineNodeResponse> {
    await this.requireBranch(userId, workId, branchId);
    return this.toResponse(await this.requireNode(workId, branchId, outlineId));
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: CreateOutlineNodeInput,
  ): Promise<OutlineNodeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${workId}:${branchId}:outline`}))`,
      );

      if (input.level === 'book') {
        const [book] = await tx
          .select({ id: chapterOutlines.id })
          .from(chapterOutlines)
          .where(
            and(
              eq(chapterOutlines.workId, workId),
              eq(chapterOutlines.branchId, branchId),
              eq(chapterOutlines.level, 'book'),
            ),
          )
          .limit(1);
        if (book) {
          throw storyPlanningError(
            HttpStatus.CONFLICT,
            'OUTLINE_BOOK_EXISTS',
            'This story already has a whole-book outline',
          );
        }
      } else {
        const parent = input.parentId
          ? await this.findNodeWith(tx, workId, branchId, input.parentId)
          : null;
        this.requireValidParent(input.level, parent);
      }

      const parentId = input.parentId ?? null;
      const [order] = await tx
        .select({ value: max(chapterOutlines.orderIndex) })
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branchId),
            parentId ? eq(chapterOutlines.parentId, parentId) : isNull(chapterOutlines.parentId),
          ),
        );

      let chapterNumber = input.chapterNumber ?? null;
      if (input.level === 'chapter' && chapterNumber === null) {
        const [chapterMax] = await tx
          .select({ value: max(chapterOutlines.chapterNumber) })
          .from(chapterOutlines)
          .where(
            and(
              eq(chapterOutlines.workId, workId),
              eq(chapterOutlines.branchId, branchId),
              eq(chapterOutlines.level, 'chapter'),
            ),
          );
        chapterNumber = (chapterMax?.value ?? 0) + 1;
      }
      if (input.level === 'chapter' && chapterNumber !== null) {
        const [conflict] = await tx
          .select({ id: chapterOutlines.id })
          .from(chapterOutlines)
          .where(
            and(
              eq(chapterOutlines.workId, workId),
              eq(chapterOutlines.branchId, branchId),
              eq(chapterOutlines.chapterNumber, chapterNumber),
            ),
          )
          .limit(1);
        if (conflict) {
          throw storyPlanningError(
            HttpStatus.CONFLICT,
            'OUTLINE_CHAPTER_NUMBER_CONFLICT',
            'Another chapter already uses this chapter number',
          );
        }
      }

      const now = new Date();
      const [created] = await tx
        .insert(chapterOutlines)
        .values({
          workId,
          branchId,
          level: input.level,
          parentId,
          orderIndex: (order?.value ?? -1) + 1,
          title: input.title,
          summary: input.summary,
          details: input.details,
          chapterNumber,
          chapterGoal: input.chapterGoal,
          pov: input.pov,
          sceneBeats: input.sceneBeats,
          chapterEndHook: input.chapterEndHook,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
      return created;
    });

    return this.toResponse(row);
  }

  async update(
    userId: string,
    workId: string,
    branchId: string,
    outlineId: string,
    input: UpdateOutlineNodeInput,
  ): Promise<OutlineNodeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${workId}:${branchId}:outline`}))`,
      );
      const current = await this.findNodeWith(tx, workId, branchId, outlineId);
      if (!current) {
        throw this.notFound();
      }
      this.requireLockedChange(current, input);

      if (input.parentId !== undefined) {
        const parent =
          input.parentId === null
            ? null
            : await this.findNodeWith(tx, workId, branchId, input.parentId);
        if (
          (current.level === 'book' && input.parentId !== null) ||
          (current.level !== 'book' && input.parentId === null)
        ) {
          throw this.invalidParent();
        }
        if (current.level !== 'book') {
          this.requireValidParent(current.level, parent);
        }
      }

      if (input.chapterNumber && input.chapterNumber !== current.chapterNumber) {
        const [conflict] = await tx
          .select({ id: chapterOutlines.id })
          .from(chapterOutlines)
          .where(
            and(
              eq(chapterOutlines.workId, workId),
              eq(chapterOutlines.branchId, branchId),
              eq(chapterOutlines.chapterNumber, input.chapterNumber),
            ),
          )
          .limit(1);
        if (conflict && conflict.id !== outlineId) {
          throw storyPlanningError(
            HttpStatus.CONFLICT,
            'OUTLINE_CHAPTER_NUMBER_CONFLICT',
            'Another chapter already uses this chapter number',
          );
        }
      }

      const changes: Partial<ChapterOutlineRow> = {
        version: current.version + 1,
        updatedAt: new Date(),
      };
      if (input.title !== undefined) changes.title = input.title;
      if (input.summary !== undefined) changes.summary = input.summary;
      if (input.details !== undefined) changes.details = input.details;
      if (input.parentId !== undefined) changes.parentId = input.parentId;
      if (input.chapterNumber !== undefined) changes.chapterNumber = input.chapterNumber;
      if (input.chapterGoal !== undefined) changes.chapterGoal = input.chapterGoal;
      if (input.pov !== undefined) changes.pov = input.pov;
      if (input.sceneBeats !== undefined) changes.sceneBeats = input.sceneBeats;
      if (input.chapterEndHook !== undefined) changes.chapterEndHook = input.chapterEndHook;

      const [updated] = await tx
        .update(chapterOutlines)
        .set(changes)
        .where(eq(chapterOutlines.id, outlineId))
        .returning();
      await tx.update(works).set({ updatedAt: changes.updatedAt }).where(eq(works.id, workId));
      return updated;
    });

    return this.toResponse(row);
  }

  async remove(
    userId: string,
    workId: string,
    branchId: string,
    outlineId: string,
    input: { confirmLockedChange?: boolean; changeReason?: string },
  ): Promise<void> {
    await this.requireBranch(userId, workId, branchId);
    await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${workId}:${branchId}:outline`}))`,
      );
      const current = await this.findNodeWith(tx, workId, branchId, outlineId);
      if (!current) {
        throw this.notFound();
      }
      this.requireLockedChange(current, input);
      await tx.delete(chapterOutlines).where(eq(chapterOutlines.id, outlineId));
      await tx.update(works).set({ updatedAt: new Date() }).where(eq(works.id, workId));
    });
  }

  async lock(
    userId: string,
    workId: string,
    branchId: string,
    outlineId: string,
  ): Promise<OutlineNodeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [row] = await this.database.db
      .update(chapterOutlines)
      .set({
        lockedAt: new Date(),
        lockedBy: userId,
        version: sql`${chapterOutlines.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chapterOutlines.id, outlineId),
          eq(chapterOutlines.workId, workId),
          eq(chapterOutlines.branchId, branchId),
        ),
      )
      .returning();
    if (!row) {
      throw this.notFound();
    }
    return this.toResponse(row);
  }

  async unlock(
    userId: string,
    workId: string,
    branchId: string,
    outlineId: string,
  ): Promise<OutlineNodeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [row] = await this.database.db
      .update(chapterOutlines)
      .set({
        lockedAt: null,
        lockedBy: null,
        version: sql`${chapterOutlines.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chapterOutlines.id, outlineId),
          eq(chapterOutlines.workId, workId),
          eq(chapterOutlines.branchId, branchId),
        ),
      )
      .returning();
    if (!row) {
      throw this.notFound();
    }
    return this.toResponse(row);
  }

  async reorder(
    userId: string,
    workId: string,
    branchId: string,
    input: ReorderOutlineNodesInput,
  ): Promise<{ items: OutlineNodeResponse[] }> {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${workId}:${branchId}:outline`}))`,
      );
      const current = await tx
        .select()
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branchId),
            input.parentId
              ? eq(chapterOutlines.parentId, input.parentId)
              : isNull(chapterOutlines.parentId),
          ),
        );
      const byId = new Map(current.map((row) => [row.id, row]));
      if (
        input.orderedIds.some((id) => !byId.has(id)) ||
        input.orderedIds.length !== current.length
      ) {
        throw storyPlanningError(
          HttpStatus.BAD_REQUEST,
          'OUTLINE_REORDER_INVALID',
          'Reorder every item under the same parent',
        );
      }
      if (input.orderedIds.some((id) => Boolean(byId.get(id)?.lockedAt))) {
        if (!input.confirmLockedChange || !input.changeReason) {
          throw storyPlanningError(
            HttpStatus.CONFLICT,
            'OUTLINE_LOCKED',
            'Confirm the change and record a reason before reordering a locked outline node',
            {
              requiresConfirmation: true,
              reasonRequired: true,
            },
          );
        }
      }

      const now = new Date();
      for (const [orderIndex, id] of input.orderedIds.entries()) {
        await tx
          .update(chapterOutlines)
          .set({ orderIndex, updatedAt: now })
          .where(eq(chapterOutlines.id, id));
      }
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
      return tx
        .select()
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branchId),
            input.parentId
              ? eq(chapterOutlines.parentId, input.parentId)
              : isNull(chapterOutlines.parentId),
          ),
        )
        .orderBy(asc(chapterOutlines.orderIndex));
    });

    return { items: rows.map((row) => this.toResponse(row)) };
  }

  async regenerate(
    userId: string,
    workId: string,
    branchId: string,
    outlineId: string,
    input: RegenerateOutlineNodeInput,
  ): Promise<OutlineNodeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const current = await this.requireNode(workId, branchId, outlineId);
    this.requireLockedChange(current, input);
    const credentials = await this.modelConfigs.purposeCredentials(userId, 'planning');
    if (!credentials) {
      throw storyPlanningError(
        HttpStatus.CONFLICT,
        'MODEL_CONFIG_REQUIRED',
        'Configure a planning model before regenerating an outline node',
      );
    }

    let generated;
    try {
      const result = await this.gateway.generateObject({
        prompt: [
          '请只重写当前大纲节点，不要改写其他节点。',
          `节点层级：${OUTLINE_LEVEL_LABELS[current.level]}`,
          `当前标题：${current.title}`,
          `当前摘要：${current.summary}`,
          `当前细节：${current.details}`,
          `章目标：${current.chapterGoal}`,
          `叙事视角：${current.pov}`,
          `场景节拍：${current.sceneBeats.join(' / ')}`,
          `章末钩子：${current.chapterEndHook}`,
          `作者要求：${input.instruction ?? '增强冲突与可执行性'}`,
        ].join('\n'),
        system: '你是中文长篇小说大纲编辑，只输出符合给定结构的 JSON。',
        model: credentials.model,
        apiKey: credentials.apiKey,
        baseUrl: credentials.baseUrl,
        schemaName: 'outline_node',
        schemaDescription: '一个重生成后的大纲节点',
        jsonSchema: {
          type: 'object',
          required: ['title', 'summary', 'details'],
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            details: { type: 'string' },
            chapterGoal: { type: 'string' },
            pov: { type: 'string' },
            sceneBeats: { type: 'array', items: { type: 'string' } },
            chapterEndHook: { type: 'string' },
          },
        },
        parse: (value) => outlineRegenerationSchema.parse(value),
      });
      generated = result.object;
    } catch (error) {
      if (error instanceof AiGatewayError) {
        throw storyPlanningError(
          HttpStatus.BAD_GATEWAY,
          'OUTLINE_REGENERATION_FAILED',
          'The outline node could not be regenerated',
        );
      }
      throw error;
    }

    const now = new Date();
    const changes: Partial<ChapterOutlineRow> = {
      title: generated.title,
      summary: generated.summary,
      details: generated.details,
      version: current.version + 1,
      updatedAt: now,
    };
    if (current.level === 'chapter') {
      if (generated.chapterGoal !== undefined) changes.chapterGoal = generated.chapterGoal;
      if (generated.pov !== undefined) changes.pov = generated.pov;
      if (generated.sceneBeats !== undefined) changes.sceneBeats = generated.sceneBeats;
      if (generated.chapterEndHook !== undefined) {
        changes.chapterEndHook = generated.chapterEndHook;
      }
    }
    const [updated] = await this.database.db
      .update(chapterOutlines)
      .set(changes)
      .where(eq(chapterOutlines.id, outlineId))
      .returning();
    await this.database.db.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
    return this.toResponse(updated);
  }

  async readiness(userId: string, workId: string, branchId: string, query: OutlineReadinessQuery) {
    await this.requireBranch(userId, workId, branchId);
    const nodes = await this.database.db
      .select()
      .from(chapterOutlines)
      .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId)));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const connectedIds = new Set<string>();
    for (const node of nodes) {
      let current = node;
      const seen = new Set<string>();
      while (current.level !== 'book' && !seen.has(current.id)) {
        seen.add(current.id);
        const expectedParent = OUTLINE_PARENT_LEVEL[current.level];
        const parent = current.parentId ? byId.get(current.parentId) : undefined;
        if (!parent || !expectedParent || parent.level !== expectedParent) {
          break;
        }
        current = parent;
      }
      if (current.level === 'book' && byId.has(current.id)) {
        for (const id of seen) {
          connectedIds.add(id);
        }
        connectedIds.add(current.id);
      }
    }

    const missing: string[] = [];
    if (!nodes.some((node) => node.level === 'book' && connectedIds.has(node.id))) {
      missing.push('全书总纲');
    }
    if (!nodes.some((node) => node.level === 'volume' && connectedIds.has(node.id))) {
      missing.push('卷纲');
    }
    if (!nodes.some((node) => node.level === 'act' && connectedIds.has(node.id))) {
      missing.push('幕纲');
    }
    const targetChapter = query.chapterNumber;
    if (
      !nodes.some(
        (node) =>
          node.level === 'chapter' &&
          connectedIds.has(node.id) &&
          (targetChapter === undefined || node.chapterNumber === targetChapter),
      )
    ) {
      missing.push(targetChapter === undefined ? '章纲' : `第 ${targetChapter} 章章纲`);
    }
    const orphanNodes = nodes.filter((node) => !connectedIds.has(node.id));
    if (orphanNodes.length > 0) {
      const titles = orphanNodes.slice(0, 5).map((node) => node.title);
      missing.push(
        `孤立节点：${titles.join('、')}${orphanNodes.length > titles.length ? ` 等 ${orphanNodes.length} 个` : ''}`,
      );
    }
    const outline: ReadinessCheck = {
      ready: missing.length === 0,
      label: '大纲',
      detail: missing.length === 0 ? '全书、卷、幕和章均已就绪。' : '大纲还有未补齐的层级。',
      missing,
    };

    const [bible] = await this.database.db
      .select()
      .from(storyBibles)
      .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)))
      .limit(1);
    const bibleComplete = bible
      ? storyBibleCompletion(normalizeStoryBibleCards(bible.cards, bible)).complete
      : false;
    const [entityCountRow] = await this.database.db
      .select({ value: count() })
      .from(entities)
      .where(
        and(
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          isNull(entities.deletedAt),
        ),
      );
    const entityCount = Number(entityCountRow?.value ?? 0);
    const settingsMissing: string[] = [];
    if (!bibleComplete) settingsMissing.push('故事圣经');
    if (entityCount === 0) settingsMissing.push('设定条目');
    const settings: ReadinessCheck = {
      ready: settingsMissing.length === 0,
      label: '设定',
      detail:
        settingsMissing.length === 0
          ? `故事圣经完整，已有 ${entityCount} 个设定条目。`
          : '设定还有未补齐的内容。',
      missing: settingsMissing,
    };

    const [factCountRow] = await this.database.db
      .select({ value: count() })
      .from(facts)
      .where(and(eq(facts.workId, workId), eq(facts.branchId, branchId)));
    const [writtenCountRow] = await this.database.db
      .select({ value: count() })
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
          sql`${chapters.currentVersionId} is not null`,
        ),
      );
    const factCount = Number(factCountRow?.value ?? 0);
    const writtenCount = Number(writtenCountRow?.value ?? 0);
    const factsReady = factCount > 0 || writtenCount === 0;
    const confirmedFacts: ReadinessCheck = {
      ready: factsReady,
      label: '已确认设定',
      detail:
        factCount > 0
          ? `已有 ${factCount} 条已确认设定。`
          : writtenCount === 0
            ? '已有 0 条已确认设定，首次生成前无需前序事实。'
            : '已有正文，但还没有确认任何设定。',
      missing: factsReady ? [] : ['已确认设定'],
    };

    let credentials = null;
    try {
      credentials = await this.modelConfigs.purposeCredentials(userId, 'planning');
    } catch {
      credentials = null;
    }
    const modelKey: ReadinessCheck = {
      ready: credentials !== null,
      label: '模型 Key',
      detail: credentials ? `规划模型“${credentials.name}”已配置。` : '还没有可用的模型配置。',
      missing: credentials ? [] : ['模型配置'],
    };

    return {
      ready: outline.ready && settings.ready && confirmedFacts.ready && modelKey.ready,
      checks: {
        outline,
        settings,
        confirmedFacts,
        modelKey,
      },
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

  private async requireNode(
    workId: string,
    branchId: string,
    outlineId: string,
  ): Promise<ChapterOutlineRow> {
    const row = await this.findNodeWith(this.database.db, workId, branchId, outlineId);
    if (!row) {
      throw this.notFound();
    }
    return row;
  }

  private async findNodeWith(
    database: Pick<DatabaseService['db'], 'select'>,
    workId: string,
    branchId: string,
    outlineId: string,
  ): Promise<ChapterOutlineRow | null> {
    const [row] = await database
      .select()
      .from(chapterOutlines)
      .where(
        and(
          eq(chapterOutlines.id, outlineId),
          eq(chapterOutlines.workId, workId),
          eq(chapterOutlines.branchId, branchId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private requireValidParent(level: OutlineLevel, parent: ChapterOutlineRow | null): void {
    const expected = OUTLINE_PARENT_LEVEL[level];
    if (!parent || !expected || parent.level !== expected) {
      throw this.invalidParent();
    }
  }

  private requireLockedChange(
    current: ChapterOutlineRow,
    input: { confirmLockedChange?: boolean; changeReason?: string },
  ): void {
    if (!current.lockedAt) {
      return;
    }
    if (!input.confirmLockedChange || !input.changeReason) {
      throw storyPlanningError(
        HttpStatus.CONFLICT,
        'OUTLINE_LOCKED',
        'Confirm the change and record a reason before editing the locked outline node',
        {
          requiresConfirmation: true,
          reasonRequired: true,
          version: current.version,
        },
      );
    }
  }

  private toResponse(row: ChapterOutlineRow): OutlineNodeResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      level: row.level,
      levelLabel: OUTLINE_LEVEL_LABELS[row.level],
      parentId: row.parentId,
      orderIndex: row.orderIndex,
      title: row.title,
      summary: row.summary,
      details: row.details,
      chapterNumber: row.chapterNumber,
      chapterGoal: row.chapterGoal,
      pov: row.pov,
      sceneBeats: row.sceneBeats,
      chapterEndHook: row.chapterEndHook,
      locked: row.lockedAt !== null,
      lockedAt: row.lockedAt?.toISOString() ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private notFound() {
    return storyPlanningError(HttpStatus.NOT_FOUND, 'OUTLINE_NOT_FOUND', 'Outline node not found');
  }

  private invalidParent() {
    return storyPlanningError(
      HttpStatus.BAD_REQUEST,
      'OUTLINE_PARENT_INVALID',
      'Choose a parent from the previous outline level',
    );
  }
}
