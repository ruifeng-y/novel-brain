import { HttpStatus, Injectable } from '@nestjs/common';
import {
  PARALLEL_VERSION_KIND_LABELS,
  PARALLEL_VERSION_STATUS_LABELS,
  type CherryPickInput,
  type CompareParallelVersionInput,
  type CreateParallelVersionInput,
  type ParallelVersionKind,
} from '@novel/contracts';
import {
  chapterOutlines,
  chapters,
  chapterVersions,
  entities,
  entityRelations,
  storyBibles,
  workBranches,
  works,
  type WorkBranchForkSnapshotValue,
  type WorkBranchRow,
} from '@novel/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { ChangesService } from '../changes/changes.service';
import { DatabaseService } from '../database/database.service';
import { branchesError } from './branches.errors';

type BranchDatabase = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

type VersionPoint = {
  id: string;
  kind: 'current' | 'chapter_version';
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string;
  chapterVersionId: string | null;
  version: number | null;
  sourceLabel: string;
  label: string;
};

type BranchResponse = {
  id: string;
  workId: string;
  name: string;
  isMain: boolean;
  parentBranchId: string | null;
  parentBranchName: string | null;
  kind: ParallelVersionKind;
  kindLabel: string;
  reason: string;
  status: WorkBranchRow['status'];
  statusLabel: string;
  forkPoint: {
    kind: VersionPoint['kind'];
    chapterNumber: number | null;
    chapterVersionId: string | null;
    chapterTitle: string;
    label: string;
  };
  createdAt: string;
};

type CompareField = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
};

type CompareItem = {
  id: string;
  comparedId: string | null;
  label: string;
  status: 'changed' | 'only_source' | 'only_compared' | 'same';
  conflict: boolean;
  fields: CompareField[];
};

type CompareResponse = {
  sourceBranch: { id: string; name: string };
  comparedBranch: { id: string; name: string };
  settings: CompareItem[];
  outlines: CompareItem[];
  chapters: CompareItem[];
  summary: {
    settingsChanged: number;
    outlinesChanged: number;
    chaptersChanged: number;
    conflicts: number;
  };
};

type CherryPickResult = {
  items: Array<{
    type: CherryPickInput['items'][number]['type'];
    id: string;
    targetId: string | null;
    label: string;
    status: 'applied' | 'pending' | 'skipped';
    message: string;
    changeRequestId: string | null;
  }>;
  summary: {
    applied: number;
    pending: number;
    skipped: number;
  };
};

@Injectable()
export class BranchesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly changes: ChangesService,
  ) {}

  async list(userId: string, workId: string): Promise<{ items: BranchResponse[] }> {
    await this.requireWork(userId, workId);
    const rows = await this.database.db
      .select()
      .from(workBranches)
      .where(eq(workBranches.workId, workId))
      .orderBy(desc(workBranches.isMain), asc(workBranches.createdAt));
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return { items: rows.map((row) => this.toResponse(row, names)) };
  }

  async versionPoints(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<{ items: VersionPoint[] }> {
    await this.requireBranch(userId, workId, branchId);
    const versionRows = await this.database.db
      .select({
        chapter: chapters,
        version: chapterVersions,
        outlineTitle: chapterOutlines.title,
      })
      .from(chapterVersions)
      .innerJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
      .leftJoin(
        chapterOutlines,
        and(
          eq(chapterOutlines.workId, chapters.workId),
          eq(chapterOutlines.branchId, chapters.branchId),
          eq(chapterOutlines.chapterNumber, chapters.chapterNumber),
          eq(chapterOutlines.level, 'chapter'),
        ),
      )
      .where(and(eq(chapters.workId, workId), eq(chapters.branchId, branchId)))
      .orderBy(asc(chapters.chapterNumber), desc(chapterVersions.version));

    return {
      items: [
        {
          id: 'current',
          kind: 'current',
          chapterId: null,
          chapterNumber: null,
          chapterTitle: '',
          chapterVersionId: null,
          version: null,
          sourceLabel: '当前状态',
          label: '当前创作线',
        },
        ...versionRows.map(({ chapter, version, outlineTitle }) => {
          const chapterTitle = chapter.title || outlineTitle || `第 ${chapter.chapterNumber} 章`;
          return {
            id: version.id,
            kind: 'chapter_version' as const,
            chapterId: chapter.id,
            chapterNumber: chapter.chapterNumber,
            chapterTitle,
            chapterVersionId: version.id,
            version: version.version,
            sourceLabel: version.source === 'generated' ? '生成版本' : '保存版本',
            label: `第 ${chapter.chapterNumber} 章 · ${chapterTitle} · 版本 ${version.version}`,
          };
        }),
      ],
    };
  }

  async create(
    userId: string,
    workId: string,
    input: CreateParallelVersionInput,
  ): Promise<BranchResponse> {
    const source = await this.requireBranch(userId, workId, input.sourceBranchId);
    const versionPoint = await this.resolveVersionPoint(
      workId,
      source.branch.id,
      input.versionPointId,
    );
    const [existing] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.workId, workId), eq(workBranches.name, input.name)))
      .limit(1);
    if (existing) {
      throw branchesError(
        HttpStatus.CONFLICT,
        'BRANCH_NAME_CONFLICT',
        'A parallel version with this name already exists',
      );
    }

    const now = new Date();
    const forkSnapshot = await this.buildForkSnapshot(workId, source.branch.id);
    const created = await this.database.db.transaction(async (tx) => {
      const [branch] = await tx
        .insert(workBranches)
        .values({
          workId,
          name: input.name,
          isMain: false,
          parentBranchId: source.branch.id,
          kind: input.kind,
          reason: input.reason,
          forkPointKind: versionPoint.kind,
          forkChapterId: versionPoint.chapterId,
          forkChapterVersionId: versionPoint.chapterVersionId,
          forkChapterNumber: versionPoint.chapterNumber,
          forkSnapshot,
          status: 'active',
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.copyActiveStory(
        tx,
        userId,
        workId,
        source.branch.id,
        branch.id,
        versionPoint,
        now,
      );
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
      return branch;
    });

    return this.toResponse(created, new Map([[source.branch.id, source.branch.name]]));
  }

  async compare(
    userId: string,
    workId: string,
    branchId: string,
    input: CompareParallelVersionInput,
  ): Promise<CompareResponse> {
    const source = await this.requireBranch(userId, workId, branchId);
    const compared = await this.requireBranch(userId, workId, input.withBranchId);
    const [sourceEntities, comparedEntities, sourceOutlines, comparedOutlines] = await Promise.all([
      this.loadEntities(workId, source.branch.id),
      this.loadEntities(workId, compared.branch.id),
      this.loadOutlines(workId, source.branch.id),
      this.loadOutlines(workId, compared.branch.id),
    ]);
    const [sourceChapters, comparedChapters] = await Promise.all([
      this.loadChaptersWithContent(workId, source.branch.id),
      this.loadChaptersWithContent(workId, compared.branch.id),
    ]);

    const settings = this.compareByKey(
      sourceEntities,
      comparedEntities,
      (row) => this.settingKey(row.type, row.name),
      (row) => row.id,
      (row) => row.name,
      (row) => ({
        name: row.name,
        summary: row.summary,
        description: row.description,
        status: row.status,
        aliases: row.aliases,
        tags: row.tags,
        customFields: row.customFields,
      }),
      (row) => this.settingFingerprint(row),
      compared.branch.forkSnapshot.settings,
      SETTING_FIELDS,
    );
    const outlines = this.compareByKey(
      sourceOutlines,
      comparedOutlines,
      (row) => this.outlineKey(row),
      (row) => row.id,
      (row) => this.outlineLabel(row),
      (row) => ({
        title: row.title,
        summary: row.summary,
        details: row.details,
        chapterGoal: row.chapterGoal,
        pov: row.pov,
        sceneBeats: row.sceneBeats,
        chapterEndHook: row.chapterEndHook,
        chapterNumber: row.chapterNumber,
        version: row.version,
      }),
      (row) => this.outlineFingerprint(row),
      compared.branch.forkSnapshot.outlines,
      OUTLINE_FIELDS,
    );
    const chapters = this.compareByKey(
      sourceChapters,
      comparedChapters,
      ({ chapter }) => String(chapter.chapterNumber),
      ({ chapter }) => chapter.id,
      ({ chapter }) => `第 ${chapter.chapterNumber} 章 · ${chapter.title}`,
      ({ chapter, content }) => ({
        title: chapter.title,
        status: chapter.status,
        summary: chapter.summary,
        hook: chapter.hook,
        content: content ?? chapter.autosaveContent,
      }),
      (row) => this.chapterFingerprint(row),
      compared.branch.forkSnapshot.chapters,
      CHAPTER_FIELDS,
    );

    return {
      sourceBranch: { id: source.branch.id, name: source.branch.name },
      comparedBranch: { id: compared.branch.id, name: compared.branch.name },
      settings,
      outlines,
      chapters,
      summary: {
        settingsChanged: settings.filter((item) => item.status !== 'same').length,
        outlinesChanged: outlines.filter((item) => item.status !== 'same').length,
        chaptersChanged: chapters.filter((item) => item.status !== 'same').length,
        conflicts: [...settings, ...outlines, ...chapters].filter((item) => item.conflict).length,
      },
    };
  }

  async cherryPick(
    userId: string,
    workId: string,
    sourceBranchId: string,
    input: CherryPickInput,
  ): Promise<CherryPickResult> {
    const source = await this.requireBranch(userId, workId, sourceBranchId);
    const target = await this.requireBranch(userId, workId, input.targetBranchId);
    if (!target.branch.isMain) {
      throw branchesError(
        HttpStatus.BAD_REQUEST,
        'CHERRY_PICK_TARGET_MAIN_REQUIRED',
        'Selective pickup can only bring content back into the main line',
      );
    }
    if (source.branch.id === target.branch.id) {
      throw branchesError(
        HttpStatus.BAD_REQUEST,
        'CHERRY_PICK_SAME_BRANCH',
        'Choose a parallel version to pick content from',
      );
    }

    const items: CherryPickResult['items'] = [];
    for (const item of input.items) {
      items.push(
        await this.pickOne(userId, workId, source.branch, target.branch, item.type, item.id),
      );
    }
    return {
      items,
      summary: {
        applied: items.filter((item) => item.status === 'applied').length,
        pending: items.filter((item) => item.status === 'pending').length,
        skipped: items.filter((item) => item.status === 'skipped').length,
      },
    };
  }

  private async pickOne(
    userId: string,
    workId: string,
    sourceBranch: WorkBranchRow,
    targetBranch: WorkBranchRow,
    type: CherryPickInput['items'][number]['type'],
    id: string,
  ): Promise<CherryPickResult['items'][number]> {
    try {
      if (type === 'chapter') {
        return await this.pickChapter(userId, workId, sourceBranch, targetBranch, id);
      }
      if (type === 'setting') {
        return await this.pickSetting(userId, workId, sourceBranch, targetBranch, id);
      }
      return await this.pickOutline(userId, workId, sourceBranch, targetBranch, id);
    } catch (error) {
      if (error instanceof PickupSkip) {
        return {
          type,
          id,
          targetId: null,
          label: error.label,
          status: 'skipped',
          message: error.message,
          changeRequestId: null,
        };
      }
      throw error;
    }
  }

  private async pickChapter(
    userId: string,
    workId: string,
    sourceBranch: WorkBranchRow,
    targetBranch: WorkBranchRow,
    chapterId: string,
  ) {
    const [sourceChapter] = await this.database.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.id, chapterId),
          eq(chapters.workId, workId),
          eq(chapters.branchId, sourceBranch.id),
        ),
      )
      .limit(1);
    if (!sourceChapter) {
      throw new PickupSkip('章节', '平行版本里找不到这个章节。');
    }
    const [targetChapter] = await this.database.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, workId),
          eq(chapters.branchId, targetBranch.id),
          eq(chapters.chapterNumber, sourceChapter.chapterNumber),
        ),
      )
      .limit(1);
    if (!targetChapter) {
      throw new PickupSkip(
        `第 ${sourceChapter.chapterNumber} 章 · ${sourceChapter.title}`,
        '主线里还没有对应章节，暂不能摘取。',
      );
    }
    const [sourceContent, targetContent] = await Promise.all([
      this.loadChapterContent(sourceChapter),
      this.loadChapterContent(targetChapter),
    ]);
    return this.applySelectedChange(
      userId,
      workId,
      targetBranch.id,
      'chapter',
      targetChapter.id,
      `摘取第 ${sourceChapter.chapterNumber} 章`,
      `从平行版本《${sourceBranch.name}》摘取这一章。`,
      `第 ${sourceChapter.chapterNumber} 章 · ${sourceChapter.title}`,
      {
        content: targetContent,
        title: targetChapter.title,
        summary: targetChapter.summary,
        hook: targetChapter.hook,
      },
      {
        content: sourceContent,
        title: sourceChapter.title,
        summary: sourceChapter.summary,
        hook: sourceChapter.hook,
      },
    );
  }

  private async pickSetting(
    userId: string,
    workId: string,
    sourceBranch: WorkBranchRow,
    targetBranch: WorkBranchRow,
    entityId: string,
  ) {
    const [sourceEntity] = await this.database.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.workId, workId),
          eq(entities.branchId, sourceBranch.id),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    if (!sourceEntity) {
      throw new PickupSkip('设定', '平行版本里找不到这个设定。');
    }
    const [targetEntity] = await this.database.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.workId, workId),
          eq(entities.branchId, targetBranch.id),
          eq(entities.type, sourceEntity.type),
          eq(entities.name, sourceEntity.name),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    if (!targetEntity) {
      throw new PickupSkip(sourceEntity.name, '主线里还没有同名设定，暂不能摘取。');
    }
    return this.applySelectedChange(
      userId,
      workId,
      targetBranch.id,
      this.changeTargetForEntity(sourceEntity.type),
      targetEntity.id,
      `摘取设定：${sourceEntity.name}`,
      `从平行版本《${sourceBranch.name}》摘取这条设定。`,
      sourceEntity.name,
      this.settingValues(targetEntity),
      this.settingValues(sourceEntity),
    );
  }

  private async pickOutline(
    userId: string,
    workId: string,
    sourceBranch: WorkBranchRow,
    targetBranch: WorkBranchRow,
    outlineId: string,
  ) {
    const [sourceOutline] = await this.database.db
      .select()
      .from(chapterOutlines)
      .where(
        and(
          eq(chapterOutlines.id, outlineId),
          eq(chapterOutlines.workId, workId),
          eq(chapterOutlines.branchId, sourceBranch.id),
        ),
      )
      .limit(1);
    if (!sourceOutline) {
      throw new PickupSkip('大纲节点', '平行版本里找不到这个大纲节点。');
    }
    const [targetOutline] = await this.database.db
      .select()
      .from(chapterOutlines)
      .where(
        and(
          eq(chapterOutlines.workId, workId),
          eq(chapterOutlines.branchId, targetBranch.id),
          eq(chapterOutlines.level, sourceOutline.level),
          sourceOutline.chapterNumber
            ? eq(chapterOutlines.chapterNumber, sourceOutline.chapterNumber)
            : eq(chapterOutlines.title, sourceOutline.title),
        ),
      )
      .limit(1);
    if (!targetOutline) {
      throw new PickupSkip(
        this.outlineLabel(sourceOutline),
        '主线里还没有对应的大纲节点，暂不能摘取。',
      );
    }
    return this.applySelectedChange(
      userId,
      workId,
      targetBranch.id,
      'outline',
      targetOutline.id,
      `摘取大纲：${this.outlineLabel(sourceOutline)}`,
      `从平行版本《${sourceBranch.name}》摘取这个大纲节点。`,
      this.outlineLabel(sourceOutline),
      this.outlineValues(targetOutline),
      this.outlineValues(sourceOutline),
    );
  }

  private async applySelectedChange(
    userId: string,
    workId: string,
    targetBranchId: string,
    targetType: 'chapter' | 'outline' | 'entity' | 'map' | 'faction' | 'power_item',
    targetId: string,
    title: string,
    reason: string,
    label: string,
    oldValue: Record<string, unknown>,
    newValue: Record<string, unknown>,
  ): Promise<CherryPickResult['items'][number]> {
    const created = await this.changes.create(userId, workId, targetBranchId, {
      title,
      reason,
      targetType,
      targetId,
      oldValue,
      newValue,
      source: 'author',
      risk: 'medium',
    });
    const analyzed = await this.changes.analyze(userId, workId, targetBranchId, created.id);
    if (analyzed.impact?.classification === 'safe') {
      const applied = await this.changes.apply(userId, workId, targetBranchId, created.id, {
        mode: 'apply',
      });
      return {
        type:
          targetType === 'chapter' ? 'chapter' : targetType === 'outline' ? 'outline' : 'setting',
        id: targetId,
        targetId,
        label,
        status: 'applied',
        message: '已写入主线，并保留修改记录。',
        changeRequestId: applied.id,
      };
    }
    return {
      type: targetType === 'chapter' ? 'chapter' : targetType === 'outline' ? 'outline' : 'setting',
      id: targetId,
      targetId,
      label,
      status: 'pending',
      message: '这次摘取需要先确认影响范围，已保存为修改请求。',
      changeRequestId: analyzed.id,
    };
  }

  private settingValues(row: typeof entities.$inferSelect): Record<string, unknown> {
    return {
      name: row.name,
      summary: row.summary,
      description: row.description,
      status: row.status,
      aliases: row.aliases,
      tags: row.tags,
      scope: row.scope,
      customFields: row.customFields,
    };
  }

  private outlineValues(row: typeof chapterOutlines.$inferSelect): Record<string, unknown> {
    return {
      title: row.title,
      summary: row.summary,
      details: row.details,
      chapterGoal: row.chapterGoal,
      pov: row.pov,
      sceneBeats: row.sceneBeats,
      chapterEndHook: row.chapterEndHook,
      chapterNumber: row.chapterNumber,
    };
  }

  private changeTargetForEntity(type: string): 'entity' | 'map' | 'faction' | 'power_item' {
    if (type === 'map') {
      return 'map';
    }
    if (type === 'faction') {
      return 'faction';
    }
    if (type === 'power_system' || type === 'item_technique') {
      return 'power_item';
    }
    return 'entity';
  }

  private async loadChapterContent(chapter: typeof chapters.$inferSelect): Promise<string> {
    if (!chapter.currentVersionId) {
      return chapter.autosaveContent;
    }
    const [version] = await this.database.db
      .select({ content: chapterVersions.content })
      .from(chapterVersions)
      .where(
        and(
          eq(chapterVersions.id, chapter.currentVersionId),
          eq(chapterVersions.chapterId, chapter.id),
        ),
      )
      .limit(1);
    return version?.content ?? chapter.autosaveContent;
  }

  private async resolveVersionPoint(
    workId: string,
    branchId: string,
    versionPointId: string,
  ): Promise<VersionPoint> {
    if (versionPointId === 'current') {
      return {
        id: 'current',
        kind: 'current',
        chapterId: null,
        chapterNumber: null,
        chapterTitle: '',
        chapterVersionId: null,
        version: null,
        sourceLabel: '当前状态',
        label: '当前创作线',
      };
    }

    const [row] = await this.database.db
      .select({
        chapter: chapters,
        version: chapterVersions,
        outlineTitle: chapterOutlines.title,
      })
      .from(chapterVersions)
      .innerJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
      .leftJoin(
        chapterOutlines,
        and(
          eq(chapterOutlines.workId, chapters.workId),
          eq(chapterOutlines.branchId, chapters.branchId),
          eq(chapterOutlines.chapterNumber, chapters.chapterNumber),
          eq(chapterOutlines.level, 'chapter'),
        ),
      )
      .where(
        and(
          eq(chapterVersions.id, versionPointId),
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row) {
      throw branchesError(
        HttpStatus.NOT_FOUND,
        'VERSION_POINT_NOT_FOUND',
        'The selected version point is not available in this story line',
      );
    }
    const chapterTitle =
      row.chapter.title || row.outlineTitle || `第 ${row.chapter.chapterNumber} 章`;
    return {
      id: row.version.id,
      kind: 'chapter_version',
      chapterId: row.chapter.id,
      chapterNumber: row.chapter.chapterNumber,
      chapterTitle,
      chapterVersionId: row.version.id,
      version: row.version.version,
      sourceLabel: row.version.source === 'generated' ? '生成版本' : '保存版本',
      label: `第 ${row.chapter.chapterNumber} 章 · ${chapterTitle} · 版本 ${row.version.version}`,
    };
  }

  private async buildForkSnapshot(
    workId: string,
    branchId: string,
  ): Promise<WorkBranchForkSnapshotValue> {
    const [entityRows, outlineRows, chapterRows] = await Promise.all([
      this.database.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            isNull(entities.deletedAt),
          ),
        ),
      this.database.db
        .select()
        .from(chapterOutlines)
        .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId))),
      this.database.db
        .select({ chapter: chapters, contentHash: chapterVersions.contentHash })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(and(eq(chapters.workId, workId), eq(chapters.branchId, branchId))),
    ]);

    return {
      settings: Object.fromEntries(
        entityRows.map((row) => [
          this.settingKey(row.type, row.name),
          this.settingFingerprint(row),
        ]),
      ),
      outlines: Object.fromEntries(
        outlineRows.map((row) => [this.outlineKey(row), this.outlineFingerprint(row)]),
      ),
      chapters: Object.fromEntries(
        chapterRows.map(({ chapter, contentHash }) => [
          String(chapter.chapterNumber),
          this.chapterFingerprint({ chapter, content: '', contentHash }),
        ]),
      ),
    };
  }

  private async copyActiveStory(
    tx: BranchDatabase,
    userId: string,
    workId: string,
    sourceBranchId: string,
    targetBranchId: string,
    versionPoint: VersionPoint,
    now: Date,
  ): Promise<void> {
    const [bibleRows, sourceEntities, relationRows, outlineRows, sourceChapters] =
      await Promise.all([
        tx
          .select()
          .from(storyBibles)
          .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, sourceBranchId))),
        tx
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.workId, workId),
              eq(entities.branchId, sourceBranchId),
              isNull(entities.deletedAt),
            ),
          ),
        tx
          .select()
          .from(entityRelations)
          .where(
            and(eq(entityRelations.workId, workId), eq(entityRelations.branchId, sourceBranchId)),
          ),
        tx
          .select()
          .from(chapterOutlines)
          .where(
            and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, sourceBranchId)),
          )
          .orderBy(asc(chapterOutlines.orderIndex), asc(chapterOutlines.createdAt)),
        tx
          .select()
          .from(chapters)
          .where(and(eq(chapters.workId, workId), eq(chapters.branchId, sourceBranchId)))
          .orderBy(asc(chapters.chapterNumber)),
      ]);

    for (const row of bibleRows) {
      await tx.insert(storyBibles).values({
        workId,
        branchId: targetBranchId,
        oneSentenceStory: row.oneSentenceStory,
        protagonist: row.protagonist,
        worldIronLaw: row.worldIronLaw,
        cards: row.cards,
        version: row.version,
        lockedAt: row.lockedAt,
        lockedBy: row.lockedBy,
        createdAt: now,
        updatedAt: now,
      });
    }

    const entityIds = new Map<string, string>();
    for (const row of sourceEntities) {
      const [created] = await tx
        .insert(entities)
        .values({
          workId,
          branchId: targetBranchId,
          name: row.name,
          aliases: row.aliases,
          type: row.type,
          subtype: row.subtype,
          summary: row.summary,
          description: row.description,
          tags: row.tags,
          scope: row.scope,
          status: row.status,
          source: row.source,
          customFields: row.customFields,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: entities.id });
      entityIds.set(row.id, created.id);
    }

    for (const row of relationRows) {
      const fromEntityId = entityIds.get(row.fromEntityId);
      const toEntityId = entityIds.get(row.toEntityId);
      if (!fromEntityId || !toEntityId) {
        continue;
      }
      await tx.insert(entityRelations).values({
        workId,
        branchId: targetBranchId,
        fromEntityId,
        predicate: row.predicate,
        toEntityId,
        validFrom: row.validFrom,
        validTo: row.validTo,
        source: row.source,
        createdAt: now,
        updatedAt: now,
      });
    }

    const outlineIds = new Map<string, string>();
    for (const row of outlineRows) {
      const [created] = await tx
        .insert(chapterOutlines)
        .values({
          workId,
          branchId: targetBranchId,
          level: row.level,
          parentId: null,
          orderIndex: row.orderIndex,
          title: row.title,
          summary: row.summary,
          details: row.details,
          chapterNumber: row.chapterNumber,
          chapterGoal: row.chapterGoal,
          pov: row.pov,
          sceneBeats: row.sceneBeats,
          chapterEndHook: row.chapterEndHook,
          lockedAt: row.lockedAt,
          lockedBy: row.lockedBy,
          version: row.version,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: chapterOutlines.id });
      outlineIds.set(row.id, created.id);
    }
    for (const row of outlineRows) {
      const newId = outlineIds.get(row.id);
      const parentId = row.parentId ? (outlineIds.get(row.parentId) ?? null) : null;
      if (newId && parentId) {
        await tx.update(chapterOutlines).set({ parentId }).where(eq(chapterOutlines.id, newId));
      }
    }

    for (const chapter of sourceChapters) {
      const selectedContent =
        versionPoint.chapterId === chapter.id && versionPoint.chapterVersionId
          ? await this.loadVersionContent(tx, chapter.id, versionPoint.chapterVersionId)
          : await this.loadCurrentContent(tx, chapter);
      const [createdChapter] = await tx
        .insert(chapters)
        .values({
          workId,
          branchId: targetBranchId,
          chapterNumber: chapter.chapterNumber,
          title: chapter.title,
          status: chapter.status,
          wordCount: selectedContent.wordCount,
          summary: chapter.summary,
          hook: chapter.hook,
          autosaveContent: selectedContent.content,
          autosaveUpdatedAt: selectedContent.content ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (selectedContent.content) {
        const [createdVersion] = await tx
          .insert(chapterVersions)
          .values({
            chapterId: createdChapter.id,
            version: 1,
            content: selectedContent.content,
            contentHash:
              selectedContent.contentHash ??
              createHash('sha256').update(selectedContent.content).digest('hex'),
            wordCount: selectedContent.wordCount,
            createdBy: userId,
            source: 'manual',
            createdAt: now,
          })
          .returning();
        await tx
          .update(chapters)
          .set({ currentVersionId: createdVersion.id, autosaveUpdatedAt: now })
          .where(eq(chapters.id, createdChapter.id));
      }
    }
  }

  private async loadVersionContent(
    tx: BranchDatabase,
    chapterId: string,
    versionId: string,
  ): Promise<{ content: string; contentHash: string | null; wordCount: number }> {
    const [row] = await tx
      .select()
      .from(chapterVersions)
      .where(and(eq(chapterVersions.id, versionId), eq(chapterVersions.chapterId, chapterId)))
      .limit(1);
    return row
      ? { content: row.content, contentHash: row.contentHash, wordCount: row.wordCount }
      : { content: '', contentHash: null, wordCount: 0 };
  }

  private async loadCurrentContent(
    tx: BranchDatabase,
    chapter: typeof chapters.$inferSelect,
  ): Promise<{ content: string; contentHash: string | null; wordCount: number }> {
    if (chapter.currentVersionId) {
      const loaded = await this.loadVersionContent(tx, chapter.id, chapter.currentVersionId);
      if (loaded.content) {
        return loaded;
      }
    }
    return {
      content: chapter.autosaveContent,
      contentHash: chapter.autosaveContent
        ? createHash('sha256').update(chapter.autosaveContent).digest('hex')
        : null,
      wordCount: chapter.wordCount,
    };
  }

  private toResponse(row: WorkBranchRow, names: Map<string, string>): BranchResponse {
    return {
      id: row.id,
      workId: row.workId,
      name: row.name,
      isMain: row.isMain,
      parentBranchId: row.parentBranchId,
      parentBranchName: row.parentBranchId ? (names.get(row.parentBranchId) ?? null) : null,
      kind: row.kind,
      kindLabel: PARALLEL_VERSION_KIND_LABELS[row.kind],
      reason: row.reason,
      status: row.status,
      statusLabel: PARALLEL_VERSION_STATUS_LABELS[row.status],
      forkPoint: {
        kind: row.forkPointKind,
        chapterNumber: row.forkChapterNumber,
        chapterVersionId: row.forkChapterVersionId,
        chapterTitle: '',
        label:
          row.forkPointKind === 'chapter_version' && row.forkChapterNumber
            ? `第 ${row.forkChapterNumber} 章`
            : '当前状态',
      },
      createdAt: row.createdAt.toISOString(),
    };
  }

  private settingKey(type: string, name: string): string {
    return `${type}:${name}`;
  }

  private settingFingerprint(row: typeof entities.$inferSelect): string {
    return this.fingerprint({
      name: row.name,
      summary: row.summary,
      description: row.description,
      status: row.status,
      aliases: row.aliases,
      tags: row.tags,
      customFields: row.customFields,
    });
  }

  private outlineKey(row: typeof chapterOutlines.$inferSelect): string {
    return row.chapterNumber
      ? `chapter:${row.chapterNumber}`
      : `${row.level}:${row.title}:${row.orderIndex}`;
  }

  private outlineLabel(row: typeof chapterOutlines.$inferSelect): string {
    return row.chapterNumber
      ? `第 ${row.chapterNumber} 章 · ${row.title}`
      : `${OUTLINE_LEVEL_TITLES[row.level]} · ${row.title}`;
  }

  private outlineFingerprint(row: typeof chapterOutlines.$inferSelect): string {
    return this.fingerprint({
      title: row.title,
      summary: row.summary,
      details: row.details,
      chapterGoal: row.chapterGoal,
      pov: row.pov,
      sceneBeats: row.sceneBeats,
      chapterEndHook: row.chapterEndHook,
      chapterNumber: row.chapterNumber,
      version: row.version,
    });
  }

  private chapterFingerprint(row: {
    chapter: typeof chapters.$inferSelect;
    content: string | null;
    contentHash?: string | null;
  }): string {
    return this.fingerprint({
      title: row.chapter.title,
      status: row.chapter.status,
      summary: row.chapter.summary,
      hook: row.chapter.hook,
      contentHash: row.contentHash ?? this.fingerprint(row.content ?? row.chapter.autosaveContent),
    });
  }

  private async loadEntities(workId: string, branchId: string) {
    return this.database.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          isNull(entities.deletedAt),
        ),
      );
  }

  private async loadOutlines(workId: string, branchId: string) {
    return this.database.db
      .select()
      .from(chapterOutlines)
      .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId)));
  }

  private async loadChaptersWithContent(workId: string, branchId: string) {
    return this.database.db
      .select({
        chapter: chapters,
        content: chapterVersions.content,
        contentHash: chapterVersions.contentHash,
      })
      .from(chapters)
      .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
      .where(and(eq(chapters.workId, workId), eq(chapters.branchId, branchId)))
      .orderBy(asc(chapters.chapterNumber));
  }

  private compareByKey<Row>(
    sourceRows: Row[],
    comparedRows: Row[],
    keyOf: (row: Row) => string,
    idOf: (row: Row) => string,
    labelOf: (row: Row) => string,
    valuesOf: (row: Row) => Record<string, unknown>,
    fingerprintOf: (row: Row) => string,
    baseline: Record<string, string> | undefined,
    fields: Array<{ field: string; label: string }>,
  ): CompareItem[] {
    const sourceMap = new Map(sourceRows.map((row) => [keyOf(row), row]));
    const comparedMap = new Map(comparedRows.map((row) => [keyOf(row), row]));
    const keys = [...new Set([...sourceMap.keys(), ...comparedMap.keys()])].sort((left, right) =>
      left.localeCompare(right, 'zh-CN'),
    );

    return keys.map((key) => {
      const source = sourceMap.get(key);
      const compared = comparedMap.get(key);
      if (!source) {
        return {
          id: key,
          comparedId: compared ? idOf(compared) : null,
          label: compared ? labelOf(compared) : key,
          status: 'only_compared' as const,
          conflict: false,
          fields: [],
        };
      }
      if (!compared) {
        return {
          id: idOf(source),
          comparedId: null,
          label: labelOf(source),
          status: 'only_source' as const,
          conflict: false,
          fields: [],
        };
      }
      const sourceValues = valuesOf(source);
      const comparedValues = valuesOf(compared);
      const changedFields = fields
        .filter(
          ({ field }) =>
            JSON.stringify(sourceValues[field]) !== JSON.stringify(comparedValues[field]),
        )
        .map(({ field, label }) => ({
          field,
          label,
          before: sourceValues[field],
          after: comparedValues[field],
        }));
      const sourceChanged = fingerprintOf(source) !== baseline?.[key];
      const comparedChanged = fingerprintOf(compared) !== baseline?.[key];
      const hasBaseline = baseline?.[key] !== undefined;
      return {
        id: idOf(source),
        comparedId: idOf(compared),
        label: labelOf(source),
        status: changedFields.length > 0 ? ('changed' as const) : ('same' as const),
        conflict: hasBaseline && sourceChanged && comparedChanged && changedFields.length > 0,
        fields: changedFields,
      };
    });
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async requireWork(userId: string, workId: string) {
    const [row] = await this.database.db
      .select()
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!row) {
      throw branchesError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    return row;
  }

  private async requireBranch(userId: string, workId: string, branchId: string) {
    const [work] = await this.database.db
      .select()
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw branchesError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    const [branch] = await this.database.db
      .select()
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw branchesError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
    return { work, branch };
  }
}

const SETTING_FIELDS = [
  { field: 'name', label: '名称' },
  { field: 'summary', label: '摘要' },
  { field: 'description', label: '详情' },
  { field: 'status', label: '状态' },
  { field: 'aliases', label: '别名' },
  { field: 'tags', label: '标签' },
  { field: 'customFields', label: '自定义设定' },
];

const OUTLINE_FIELDS = [
  { field: 'title', label: '标题' },
  { field: 'summary', label: '摘要' },
  { field: 'details', label: '细节' },
  { field: 'chapterGoal', label: '本章目标' },
  { field: 'pov', label: '叙事视角' },
  { field: 'sceneBeats', label: '场景节拍' },
  { field: 'chapterEndHook', label: '章末钩子' },
  { field: 'chapterNumber', label: '章节序号' },
  { field: 'version', label: '版本' },
];

const CHAPTER_FIELDS = [
  { field: 'title', label: '标题' },
  { field: 'status', label: '状态' },
  { field: 'summary', label: '摘要' },
  { field: 'hook', label: '章末钩子' },
  { field: 'content', label: '正文' },
];

const OUTLINE_LEVEL_TITLES: Record<typeof chapterOutlines.$inferSelect.level, string> = {
  book: '全书',
  volume: '卷',
  act: '幕',
  chapter: '章',
  scene: '场景',
};

class PickupSkip extends Error {
  constructor(
    readonly label: string,
    message: string,
  ) {
    super(message);
  }
}
