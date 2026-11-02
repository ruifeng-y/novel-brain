import { HttpStatus, Injectable } from '@nestjs/common';
import {
  countCjkCharacters,
  getGenrePackDefinition,
  HISTORY_MAIN_TEMPLATE,
  HISTORY_VARIANT_LABELS,
  WORK_STATUS_LABELS,
  WORK_STATUS_TRANSITIONS,
  type CreateWorkInput,
  type DuplicateWorkInput,
  type GenrePackDefinition,
  type HistoryVariant,
  type UpdateWorkInput,
  type WorkImportInput,
  type WorkListQuery,
} from '@novel/contracts';
import { ManuscriptImportError, parseManuscript, qualityScoreFromDimensions } from '@novel/core';
import {
  chapterOutlines,
  chapters,
  chapterVersions,
  foreshadows,
  qualityReports,
  workBranches,
  works,
  type WorkBranchRow,
  type WorkRow,
} from '@novel/db';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { BranchStateService, type BranchStateCloneTable } from '../branches/branch-state.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../versions/audit.service';
import { worksError } from './works.errors';

const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const COPY_BRANCH_TABLES: readonly BranchStateCloneTable[] = [
  'story_bibles',
  'entities',
  'entity_custom_fields',
  'entity_relations',
  'character_profiles',
  'character_states',
  'power_system_profiles',
  'golden_fingers',
  'item_technique_profiles',
  'item_ownerships',
  'timeline_eras',
  'timeline_event_nodes',
  'chapter_outlines',
  'threads',
  'foreshadows',
  'character_arcs',
  'map_nodes',
  'map_connections',
  'map_images',
  'map_markers',
  'character_presences',
];

type WorkMetrics = {
  wordCount: number;
  progressPercent: number;
  totalChapters: number;
  completedChapters: number;
  qualityScore: number | null;
  unresolvedForeshadowCount: number;
};

const EMPTY_METRICS: WorkMetrics = {
  wordCount: 0,
  progressPercent: 0,
  totalChapters: 0,
  completedChapters: 0,
  qualityScore: null,
  unresolvedForeshadowCount: 0,
};

type WorkResponse = {
  id: string;
  title: string;
  penName: string;
  genrePack: string;
  genrePackLabel: string;
  genreTemplate: GenrePackDefinition['template'] & {
    subtypes: GenrePackDefinition['subtypes'];
  };
  genreVariant: string | null;
  genreVariantLabel: string | null;
  mainTemplate: string | null;
  scale: string;
  targetPlatform: string;
  status: WorkRow['status'];
  statusLabel: string;
  wordCount: number;
  progressPercent: number;
  totalChapters: number;
  completedChapters: number;
  qualityScore: number | null;
  unresolvedForeshadowCount: number;
  foreshadowCount: number;
  lastEditedAt: string;
  createdAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  readOnly: boolean;
  mainBranch: {
    id: string;
    name: string;
    isMain: boolean;
  } | null;
};

type ImportResponse = {
  workId: string;
  branchId: string;
  format: 'txt' | 'markdown' | 'docx';
  chapterCount: number;
  wordCount: number;
  importedChapters: Array<{
    chapterNumber: number;
    title: string;
    wordCount: number;
  }>;
};

@Injectable()
export class WorksService {
  constructor(
    private readonly database: DatabaseService,
    private readonly branchState: BranchStateService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: WorkListQuery): Promise<{ items: WorkResponse[] }> {
    const filters = [eq(works.userId, userId)];
    const view = query.trash ? 'trash' : query.includeArchived ? 'all' : query.view;
    if (view === 'trash') {
      filters.push(isNotNull(works.deletedAt));
    } else {
      filters.push(isNull(works.deletedAt));
    }

    if (view === 'archived') {
      filters.push(eq(works.status, 'archived'));
    } else if (view === 'active' && !query.status) {
      filters.push(ne(works.status, 'archived'));
    }
    if (query.status) {
      filters.push(eq(works.status, query.status));
    }
    const genrePack = query.genrePack ?? query.genre;
    if (genrePack) {
      filters.push(eq(works.genrePack, genrePack));
    }
    if (query.recentDays) {
      filters.push(
        gte(works.updatedAt, new Date(Date.now() - query.recentDays * 24 * 60 * 60 * 1000)),
      );
    }

    const search = (query.search ?? query.q).trim();
    if (search) {
      const searchFilter = or(
        ilike(works.title, `%${search}%`),
        ilike(works.penName, `%${search}%`),
      );
      if (searchFilter) {
        filters.push(searchFilter);
      }
    }

    const workRows = await this.database.db
      .select()
      .from(works)
      .where(and(...filters))
      .orderBy(desc(works.updatedAt));

    if (workRows.length === 0) {
      return { items: [] };
    }

    const branchRows = await this.database.db
      .select()
      .from(workBranches)
      .where(
        and(
          inArray(
            workBranches.workId,
            workRows.map((work) => work.id),
          ),
          eq(workBranches.isMain, true),
        ),
      );
    const branchesByWorkId = new Map(branchRows.map((branch) => [branch.workId, branch]));
    const metricsByBranchId = await this.loadMetrics(branchRows.map((branch) => branch.id));

    let items = workRows.map((work) => {
      const branch = branchesByWorkId.get(work.id) ?? null;
      return this.toResponse(
        work,
        branch,
        branch ? (metricsByBranchId.get(branch.id) ?? EMPTY_METRICS) : EMPTY_METRICS,
      );
    });

    if (query.minWordCount !== undefined) {
      items = items.filter((work) => work.wordCount >= query.minWordCount!);
    }
    if (query.maxWordCount !== undefined) {
      items = items.filter((work) => work.wordCount <= query.maxWordCount!);
    }
    return { items: this.sortWorkResponses(items, query.sort) };
  }

  async create(userId: string, input: CreateWorkInput): Promise<WorkResponse> {
    const created = await this.database.db.transaction(async (tx) => {
      const [work] = await tx
        .insert(works)
        .values({
          userId,
          title: input.title,
          penName: input.penName,
          genrePack: input.genrePack,
          genreVariant:
            input.genrePack === 'history' ? (input.genreVariant ?? 'alternate_ancient') : null,
          scale: input.scale,
          targetPlatform: input.targetPlatform,
          status: 'preparing',
        })
        .returning();

      const [mainBranch] = await tx
        .insert(workBranches)
        .values({
          workId: work.id,
          name: 'main',
          isMain: true,
          status: 'active',
          createdBy: userId,
        })
        .returning();

      return { work, mainBranch };
    });

    await this.audit.record({
      userId,
      workId: created.work.id,
      branchId: created.mainBranch.id,
      action: 'work_created',
      targetType: 'work',
      targetId: created.work.id,
      title: `创建作品：${created.work.title}`,
    });
    return this.toResponse(created.work, created.mainBranch);
  }

  async createFromImport(
    userId: string,
    input: CreateWorkInput & WorkImportInput,
  ): Promise<{ work: WorkResponse } & ImportResponse> {
    const work = await this.create(userId, {
      title: input.title,
      penName: input.penName,
      genrePack: input.genrePack,
      ...(input.genreVariant === undefined ? {} : { genreVariant: input.genreVariant }),
      scale: input.scale,
      targetPlatform: input.targetPlatform,
    });
    const imported = await this.importManuscript(userId, work.id, {
      fileName: input.fileName,
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.contentBase64 === undefined ? {} : { contentBase64: input.contentBase64 }),
      ...(input.format === undefined ? {} : { format: input.format }),
    });
    return { work: await this.get(userId, work.id), ...imported };
  }

  async get(userId: string, workId: string): Promise<WorkResponse> {
    const work = await this.requireWork(userId, workId);
    return this.responseForWork(work);
  }

  async update(userId: string, workId: string, input: UpdateWorkInput): Promise<WorkResponse> {
    const current = await this.requireWork(userId, workId);
    const metadataFields = [
      'title',
      'penName',
      'genrePack',
      'genreVariant',
      'scale',
      'targetPlatform',
    ] as const;
    if (
      current.status === 'completed' &&
      metadataFields.some((field) => input[field] !== undefined)
    ) {
      throw worksError(
        HttpStatus.CONFLICT,
        'WORK_COMPLETED_READ_ONLY',
        'Reopen the work before changing its details',
        { canReopen: true, canCreateParallel: true },
      );
    }
    if (current.status === 'archived' && input.status && input.status !== 'archived') {
      throw worksError(
        HttpStatus.CONFLICT,
        'WORK_RESTORE_REQUIRED',
        'Restore the archived work before changing its status',
      );
    }

    const nextStatus = input.status ?? current.status;
    if (input.status && input.status !== current.status) {
      if (!WORK_STATUS_TRANSITIONS[current.status].includes(input.status)) {
        throw worksError(
          HttpStatus.CONFLICT,
          'WORK_STATUS_TRANSITION_INVALID',
          'This work status change is not available',
          { from: current.status, to: input.status },
        );
      }
    }

    const effectiveGenre = input.genrePack ?? current.genrePack;
    if (effectiveGenre !== 'history' && input.genreVariant !== undefined && input.genreVariant) {
      throw worksError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Only history works can choose a history variant',
      );
    }

    const now = new Date();
    const archiving = nextStatus === 'archived' && current.status !== 'archived';
    const [updated] = await this.database.db
      .update(works)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.penName === undefined ? {} : { penName: input.penName }),
        ...(input.genrePack === undefined ? {} : { genrePack: input.genrePack }),
        ...(input.genreVariant === undefined && input.genrePack === undefined
          ? {}
          : {
              genreVariant:
                effectiveGenre === 'history'
                  ? (input.genreVariant ?? current.genreVariant ?? 'alternate_ancient')
                  : null,
            }),
        ...(input.scale === undefined ? {} : { scale: input.scale }),
        ...(input.targetPlatform === undefined ? {} : { targetPlatform: input.targetPlatform }),
        status: nextStatus,
        ...(archiving ? { archivedFromStatus: current.status, archivedAt: now } : {}),
        updatedAt: now,
      })
      .where(and(eq(works.id, workId), eq(works.userId, userId)))
      .returning();

    const branch = await this.requireMainBranch(workId);
    await this.audit.record({
      userId,
      workId,
      branchId: branch.id,
      action:
        input.status && input.status !== current.status ? 'work_status_changed' : 'work_updated',
      targetType: 'work',
      targetId: workId,
      title:
        input.status && input.status !== current.status
          ? `作品状态：${WORK_STATUS_LABELS[current.status]} → ${WORK_STATUS_LABELS[input.status]}`
          : `更新作品：${updated.title}`,
      detail: input.changeReason ?? '',
      metadata: { fromStatus: current.status, toStatus: nextStatus },
    });
    return this.toResponse(updated, branch, (await this.loadMetrics([branch.id])).get(branch.id));
  }

  async archive(userId: string, workId: string): Promise<WorkResponse> {
    const work = await this.requireWork(userId, workId);
    if (work.status === 'archived') {
      return this.responseForWork(work);
    }
    const now = new Date();
    const [archived] = await this.database.db
      .update(works)
      .set({
        status: 'archived',
        archivedFromStatus: work.status,
        archivedAt: now,
        updatedAt: now,
      })
      .where(and(eq(works.id, workId), eq(works.userId, userId)))
      .returning();
    const branch = await this.requireMainBranch(workId);
    await this.audit.record({
      userId,
      workId,
      branchId: branch.id,
      action: 'work_archived',
      targetType: 'work',
      targetId: workId,
      title: `归档作品：${work.title}`,
      metadata: { previousStatus: work.status },
    });
    return this.toResponse(archived, branch, (await this.loadMetrics([branch.id])).get(branch.id));
  }

  async restore(userId: string, workId: string): Promise<WorkResponse> {
    const [work] = await this.database.db
      .select()
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId)))
      .limit(1);
    if (!work) {
      throw worksError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    if (!work.deletedAt && work.status !== 'archived') {
      throw worksError(HttpStatus.CONFLICT, 'WORK_NOT_RESTORABLE', 'This work is already active');
    }
    if (work.deletedAt && Date.now() - work.deletedAt.getTime() > RESTORE_WINDOW_MS) {
      throw worksError(
        HttpStatus.GONE,
        'WORK_RESTORE_EXPIRED',
        'The 30-day recovery window for this work has ended',
      );
    }

    const now = new Date();
    const restoredStatus =
      work.status === 'archived' ? (work.archivedFromStatus ?? 'preparing') : work.status;
    const [restored] = await this.database.db
      .update(works)
      .set({
        status: restoredStatus,
        deletedAt: null,
        archivedAt: null,
        archivedFromStatus: null,
        updatedAt: now,
      })
      .where(and(eq(works.id, workId), eq(works.userId, userId)))
      .returning();
    const branch = await this.requireMainBranch(workId);
    await this.audit.record({
      userId,
      workId,
      branchId: branch.id,
      action: 'work_restored',
      targetType: 'work',
      targetId: workId,
      title: `恢复作品：${work.title}`,
      metadata: {
        recoveredFromTrash: Boolean(work.deletedAt),
        previousStatus: work.status,
        restoredStatus,
      },
    });
    return this.toResponse(restored, branch, (await this.loadMetrics([branch.id])).get(branch.id));
  }

  async softDelete(userId: string, workId: string): Promise<void> {
    const work = await this.requireWork(userId, workId);
    const now = new Date();
    await this.database.db
      .update(works)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(works.id, workId), eq(works.userId, userId)));
    const branch = await this.requireMainBranch(workId);
    await this.audit.record({
      userId,
      workId,
      branchId: branch.id,
      action: 'work_deleted',
      targetType: 'work',
      targetId: workId,
      title: `移入回收站：${work.title}`,
      metadata: { recoverableDays: 30 },
    });
  }

  async duplicate(
    userId: string,
    workId: string,
    input: DuplicateWorkInput,
  ): Promise<WorkResponse> {
    const source = await this.requireWork(userId, workId);
    const sourceBranch = await this.requireMainBranch(workId);
    const title = input.title ?? `${source.title}副本`;
    const penName = input.penName ?? source.penName;

    const created = await this.database.db.transaction(async (tx) => {
      const [work] = await tx
        .insert(works)
        .values({
          userId,
          title,
          penName,
          genrePack: source.genrePack,
          genreVariant: source.genreVariant,
          scale: source.scale,
          targetPlatform: source.targetPlatform,
          status: 'preparing',
        })
        .returning();
      const [branch] = await tx
        .insert(workBranches)
        .values({
          workId: work.id,
          name: 'main',
          isMain: true,
          status: 'active',
          createdBy: userId,
        })
        .returning();
      const sourceReadBranchId = await this.branchState.effectiveReadBranchId(sourceBranch.id);
      await this.branchState.cloneBranchRows(
        tx,
        work.id,
        sourceReadBranchId,
        branch.id,
        false,
        COPY_BRANCH_TABLES,
      );
      return { work, branch };
    });

    await this.audit.record({
      userId,
      workId,
      branchId: sourceBranch.id,
      action: 'work_duplicated',
      targetType: 'work',
      targetId: created.work.id,
      title: `复制作品：${source.title} → ${title}`,
      metadata: { sourceWorkId: workId, copiedWorkId: created.work.id },
    });
    await this.audit.record({
      userId,
      workId: created.work.id,
      branchId: created.branch.id,
      action: 'work_created',
      targetType: 'work',
      targetId: created.work.id,
      title: `从《${source.title}》复制新作品`,
      metadata: { sourceWorkId: workId },
    });
    return this.toResponse(created.work, created.branch);
  }

  async importManuscript(
    userId: string,
    workId: string,
    input: WorkImportInput,
  ): Promise<ImportResponse> {
    const work = await this.requireWork(userId, workId);
    if (work.status === 'completed') {
      throw worksError(
        HttpStatus.CONFLICT,
        'WORK_COMPLETED_READ_ONLY',
        'Reopen the work before importing a manuscript',
        { canReopen: true, canCreateParallel: true },
      );
    }
    const parsed = await this.parseImport(input);
    if (parsed.chapters.length > 10_000) {
      throw worksError(
        HttpStatus.BAD_REQUEST,
        'IMPORT_TOO_LARGE',
        'Import at most 10,000 chapters at a time',
      );
    }
    const branch = await this.requireMainBranch(workId);
    const [chapterMax, outlineMax] = await Promise.all([
      this.database.db
        .select({ value: max(chapters.chapterNumber) })
        .from(chapters)
        .where(and(eq(chapters.workId, workId), eq(chapters.branchId, branch.id))),
      this.database.db
        .select({ value: max(chapterOutlines.chapterNumber) })
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branch.id),
            eq(chapterOutlines.level, 'chapter'),
          ),
        ),
    ]);
    const startingChapterNumber =
      Math.max(chapterMax[0]?.value ?? 0, outlineMax[0]?.value ?? 0) + 1;
    const now = new Date();
    const importedChapters: ImportResponse['importedChapters'] = [];

    await this.database.db.transaction(async (tx) => {
      for (const [index, manuscriptChapter] of parsed.chapters.entries()) {
        const chapterNumber = startingChapterNumber + index;
        const wordCount = countCjkCharacters(manuscriptChapter.content);
        const summary = manuscriptChapter.content.replace(/\s+/g, ' ').trim().slice(0, 160);
        const [chapter] = await tx
          .insert(chapters)
          .values({
            workId,
            branchId: branch.id,
            chapterNumber,
            title: manuscriptChapter.title,
            status: 'writing',
            wordCount,
            summary,
            hook: '',
            autosaveContent: manuscriptChapter.content,
            autosaveUpdatedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        const [version] = await tx
          .insert(chapterVersions)
          .values({
            chapterId: chapter.id,
            version: 1,
            content: manuscriptChapter.content,
            contentHash: createHash('sha256').update(manuscriptChapter.content).digest('hex'),
            wordCount,
            createdBy: userId,
            source: 'manual',
            createdAt: now,
          })
          .returning();
        await tx
          .update(chapters)
          .set({ currentVersionId: version.id, updatedAt: now })
          .where(eq(chapters.id, chapter.id));
        await tx.insert(chapterOutlines).values({
          workId,
          branchId: branch.id,
          level: 'chapter',
          chapterNumber,
          title: manuscriptChapter.title,
          summary,
          details: '',
          orderIndex: chapterNumber - 1,
          chapterGoal: '整理导入旧稿，确认这一章接下来要推进的方向。',
          pov: '待确认',
          sceneBeats: ['导入旧稿'],
          chapterEndHook: '待补充',
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        importedChapters.push({
          chapterNumber,
          title: manuscriptChapter.title,
          wordCount,
        });
      }
      await tx
        .update(works)
        .set({
          status: work.status === 'preparing' ? 'serializing' : work.status,
          updatedAt: now,
        })
        .where(and(eq(works.id, workId), eq(works.userId, userId)));
    });

    const wordCount = importedChapters.reduce((total, chapter) => total + chapter.wordCount, 0);
    await this.audit.record({
      userId,
      workId,
      branchId: branch.id,
      action: 'work_imported',
      targetType: 'work',
      targetId: workId,
      title: `导入旧稿：${input.fileName}`,
      detail: `导入 ${importedChapters.length} 章，共 ${wordCount} 字`,
      metadata: {
        fileName: input.fileName,
        format: parsed.format,
        chapterCount: importedChapters.length,
        wordCount,
      },
    });

    return {
      workId,
      branchId: branch.id,
      format: parsed.format,
      chapterCount: importedChapters.length,
      wordCount,
      importedChapters,
    };
  }

  private async parseImport(input: WorkImportInput) {
    try {
      return await parseManuscript(input);
    } catch (error) {
      if (error instanceof ManuscriptImportError) {
        throw worksError(HttpStatus.BAD_REQUEST, error.code, error.message);
      }
      throw error;
    }
  }

  private async requireWork(userId: string, workId: string): Promise<WorkRow> {
    const [work] = await this.database.db
      .select()
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw worksError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    return work;
  }

  private async requireMainBranch(workId: string): Promise<WorkBranchRow> {
    const [branch] = await this.database.db
      .select()
      .from(workBranches)
      .where(and(eq(workBranches.workId, workId), eq(workBranches.isMain, true)))
      .limit(1);
    if (!branch) {
      throw worksError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Main story line not found');
    }
    return branch;
  }

  private async responseForWork(work: WorkRow): Promise<WorkResponse> {
    const [mainBranch] = await this.database.db
      .select()
      .from(workBranches)
      .where(and(eq(workBranches.workId, work.id), eq(workBranches.isMain, true)))
      .limit(1);
    const metrics = mainBranch
      ? (await this.loadMetrics([mainBranch.id])).get(mainBranch.id)
      : undefined;
    return this.toResponse(work, mainBranch ?? null, metrics ?? EMPTY_METRICS);
  }

  private async loadMetrics(branchIds: string[]): Promise<Map<string, WorkMetrics>> {
    const metrics = new Map(
      branchIds.map((branchId) => [
        branchId,
        {
          ...EMPTY_METRICS,
        },
      ]),
    );
    if (branchIds.length === 0) {
      return metrics;
    }

    const [chapterRows, qualityRows, foreshadowRows] = await Promise.all([
      this.database.db
        .select({
          branchId: chapters.branchId,
          wordCount: sql<number>`coalesce(sum(${chapters.wordCount}), 0)::int`,
          chapterCount: sql<number>`count(*)::int`,
          completedCount: sql<number>`count(*) filter (where ${chapters.status} in ('locked', 'published'))::int`,
        })
        .from(chapters)
        .where(inArray(chapters.branchId, branchIds))
        .groupBy(chapters.branchId),
      this.database.db
        .select({
          branchId: qualityReports.branchId,
          report: qualityReports.report,
        })
        .from(qualityReports)
        .where(inArray(qualityReports.branchId, branchIds)),
      this.database.db
        .select({
          branchId: foreshadows.branchId,
          count: sql<number>`count(*)::int`,
        })
        .from(foreshadows)
        .where(and(inArray(foreshadows.branchId, branchIds), eq(foreshadows.status, 'planted')))
        .groupBy(foreshadows.branchId),
    ]);

    for (const row of chapterRows) {
      metrics.set(row.branchId, {
        ...(metrics.get(row.branchId) ?? EMPTY_METRICS),
        wordCount: row.wordCount,
        totalChapters: row.chapterCount,
        completedChapters: row.completedCount,
        progressPercent:
          row.chapterCount === 0 ? 0 : Math.round((row.completedCount / row.chapterCount) * 100),
      });
    }

    const dimensionsByBranch = new Map<string, Array<{ status?: string }>>();
    for (const row of qualityRows) {
      dimensionsByBranch.set(row.branchId, [
        ...(dimensionsByBranch.get(row.branchId) ?? []),
        ...(row.report.dimensions as Array<{ status?: string }>),
      ]);
    }
    for (const [branchId, dimensions] of dimensionsByBranch) {
      metrics.set(branchId, {
        ...(metrics.get(branchId) ?? EMPTY_METRICS),
        qualityScore: qualityScoreFromDimensions(dimensions),
      });
    }
    for (const row of foreshadowRows) {
      metrics.set(row.branchId, {
        ...(metrics.get(row.branchId) ?? EMPTY_METRICS),
        unresolvedForeshadowCount: row.count,
      });
    }
    return metrics;
  }

  private sortWorkResponses(items: WorkResponse[], sort: WorkListQuery['sort']): WorkResponse[] {
    const sorted = [...items];
    if (sort === 'word_count_desc' || sort === 'word_count') {
      return sorted.sort((left, right) => right.wordCount - left.wordCount);
    }
    if (sort === 'word_count_asc') {
      return sorted.sort((left, right) => left.wordCount - right.wordCount);
    }
    if (sort === 'progress_desc' || sort === 'progress') {
      return sorted.sort((left, right) => right.progressPercent - left.progressPercent);
    }
    if (sort === 'quality_desc' || sort === 'quality') {
      return sorted.sort((left, right) => (right.qualityScore ?? -1) - (left.qualityScore ?? -1));
    }
    return sorted.sort(
      (left, right) =>
        new Date(right.lastEditedAt).getTime() - new Date(left.lastEditedAt).getTime(),
    );
  }

  private toResponse(
    work: WorkRow,
    mainBranch: WorkBranchRow | null,
    metrics: WorkMetrics = EMPTY_METRICS,
  ): WorkResponse {
    const genrePack = getGenrePackDefinition(work.genrePack);
    const historyVariant =
      work.genrePack === 'history'
        ? ((work.genreVariant ?? 'alternate_ancient') as HistoryVariant)
        : null;
    return {
      id: work.id,
      title: work.title,
      penName: work.penName,
      genrePack: work.genrePack,
      genrePackLabel: genrePack?.label ?? work.genrePack,
      genreTemplate: {
        key: genrePack?.template.key ?? work.genrePack,
        name: genrePack?.template.name ?? '题材主模板',
        summary: genrePack?.template.summary ?? '',
        writingGuide: genrePack?.template.writingGuide ?? [],
        checkCategories: genrePack?.template.checkCategories ?? [],
        subtypes: genrePack?.subtypes ?? [],
      },
      genreVariant: historyVariant,
      genreVariantLabel: historyVariant ? HISTORY_VARIANT_LABELS[historyVariant] : null,
      mainTemplate: work.genrePack === 'history' ? HISTORY_MAIN_TEMPLATE : null,
      scale: work.scale,
      targetPlatform: work.targetPlatform,
      status: work.status,
      statusLabel: WORK_STATUS_LABELS[work.status],
      wordCount: metrics.wordCount,
      progressPercent: metrics.progressPercent,
      totalChapters: metrics.totalChapters,
      completedChapters: metrics.completedChapters,
      qualityScore: metrics.qualityScore,
      unresolvedForeshadowCount: metrics.unresolvedForeshadowCount,
      foreshadowCount: metrics.unresolvedForeshadowCount,
      lastEditedAt: work.updatedAt.toISOString(),
      createdAt: work.createdAt.toISOString(),
      archivedAt: work.archivedAt?.toISOString() ?? null,
      deletedAt: work.deletedAt?.toISOString() ?? null,
      readOnly: work.status === 'completed',
      mainBranch: mainBranch
        ? {
            id: mainBranch.id,
            name: mainBranch.name,
            isMain: mainBranch.isMain,
          }
        : null,
    };
  }
}
