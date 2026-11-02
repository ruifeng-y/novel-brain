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
  branchCommits,
  characterStates,
  chapterOutlines,
  chapters,
  chapterVersions,
  entities,
  facts,
  mapNodes,
  workBranches,
  works,
  type WorkBranchForkSnapshotValue,
  type WorkBranchRow,
} from '@novel/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { BranchStateService } from './branch-state.service';
import { ChangesService } from '../changes/changes.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../versions/audit.service';
import { branchesError } from './branches.errors';

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
  facts: CompareItem[];
  characters: CompareItem[];
  maps: CompareItem[];
  summary: {
    settingsChanged: number;
    outlinesChanged: number;
    chaptersChanged: number;
    factsChanged: number;
    charactersChanged: number;
    mapsChanged: number;
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
    private readonly branchState: BranchStateService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, workId: string): Promise<{ items: BranchResponse[] }> {
    await this.requireWork(userId, workId);
    const rows = await this.database.db
      .select()
      .from(workBranches)
      .where(and(eq(workBranches.workId, workId), eq(workBranches.isSnapshot, false)))
      .orderBy(desc(workBranches.isMain), asc(workBranches.createdAt));
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return { items: rows.map((row) => this.toResponse(row, names)) };
  }

  async versionPoints(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<{ items: VersionPoint[] }> {
    const logicalBranchId = await this.branchState.logicalBranchId(branchId);
    await this.requireBranch(userId, workId, logicalBranchId);
    const versionRows = await this.database.db
      .select({
        chapter: chapters,
        version: chapterVersions,
        outlineTitle: chapterOutlines.title,
      })
      .from(branchCommits)
      .innerJoin(chapterVersions, eq(chapterVersions.id, branchCommits.chapterVersionId))
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
        and(eq(branchCommits.workId, workId), eq(branchCommits.sourceBranchId, logicalBranchId)),
      )
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
    const sourceBranchId = await this.branchState.logicalBranchId(input.sourceBranchId);
    const source = await this.requireBranch(userId, workId, sourceBranchId);
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
    const forkSnapshot = await this.buildForkSnapshot(workId, versionPoint.baselineBranchId);
    const [created] = await this.database.db
      .insert(workBranches)
      .values({
        workId,
        name: input.name,
        isMain: false,
        isSnapshot: false,
        parentBranchId: source.branch.id,
        baselineBranchId: versionPoint.baselineBranchId,
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
    await this.database.db.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
    await this.audit.record({
      userId,
      workId,
      branchId: source.branch.id,
      action: 'branch_created',
      targetType: 'branch',
      targetId: created.id,
      title: `创建平行版本：${created.name}`,
      detail: input.reason,
      metadata: {
        branchId: created.id,
        forkChapterVersionId: versionPoint.chapterVersionId,
      },
    });

    return this.toResponse(created, new Map([[source.branch.id, source.branch.name]]));
  }

  async compare(
    userId: string,
    workId: string,
    branchId: string,
    input: CompareParallelVersionInput,
  ): Promise<CompareResponse> {
    const sourceBranchId = await this.branchState.logicalBranchId(branchId);
    const comparedBranchId = await this.branchState.logicalBranchId(input.withBranchId);
    const source = await this.requireBranch(userId, workId, sourceBranchId);
    const compared = await this.requireBranch(userId, workId, comparedBranchId);
    const sourceReadId = await this.branchState.effectiveReadBranchId(source.branch.id);
    const comparedReadId = await this.branchState.effectiveReadBranchId(compared.branch.id);

    const [
      sourceEntities,
      comparedEntities,
      sourceOutlines,
      comparedOutlines,
      sourceChapters,
      comparedChapters,
      sourceFacts,
      comparedFacts,
      sourceCharacters,
      comparedCharacters,
      sourceMaps,
      comparedMaps,
    ] = await Promise.all([
      this.loadEntities(workId, sourceReadId),
      this.loadEntities(workId, comparedReadId),
      this.loadOutlines(workId, sourceReadId),
      this.loadOutlines(workId, comparedReadId),
      this.loadChaptersWithContent(workId, sourceReadId),
      this.loadChaptersWithContent(workId, comparedReadId),
      this.loadFacts(workId, sourceReadId),
      this.loadFacts(workId, comparedReadId),
      this.loadCharacterStates(workId, sourceReadId),
      this.loadCharacterStates(workId, comparedReadId),
      this.loadMaps(workId, sourceReadId),
      this.loadMaps(workId, comparedReadId),
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
    const chapterItems = this.compareByKey(
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
    const factItems = this.compareByKey(
      sourceFacts,
      comparedFacts,
      (row) => `${row.fact.type}:${row.fact.statement}`,
      (row) => row.fact.id,
      (row) => `第 ${row.chapterNumber} 章 · ${row.fact.statement}`,
      (row) => ({
        statement: row.fact.statement,
        sourceSentence: row.fact.sourceSentence,
        type: row.fact.type,
      }),
      (row) => this.factFingerprint(row),
      compared.branch.forkSnapshot.facts,
      FACT_FIELDS,
    );
    const characterItems = this.compareByKey(
      sourceCharacters,
      comparedCharacters,
      (row) => row.name,
      (row) => row.state.id,
      (row) => row.name,
      (row) => ({
        body: row.state.body,
        power: row.state.power,
        location: row.state.location,
        possessions: row.state.possessions,
        disguise: row.state.disguise,
        knowledge: row.state.knowledge,
      }),
      (row) => this.characterFingerprint(row),
      compared.branch.forkSnapshot.characters,
      CHARACTER_FIELDS,
    );
    const mapItems = this.compareByKey(
      sourceMaps,
      comparedMaps,
      (row) => row.name,
      (row) => row.node.id,
      (row) => row.name,
      (row) => ({ level: row.node.level }),
      (row) => this.mapFingerprint(row),
      compared.branch.forkSnapshot.maps,
      MAP_FIELDS,
    );
    const allItems = [
      ...settings,
      ...outlines,
      ...chapterItems,
      ...factItems,
      ...characterItems,
      ...mapItems,
    ];

    return {
      sourceBranch: { id: source.branch.id, name: source.branch.name },
      comparedBranch: { id: compared.branch.id, name: compared.branch.name },
      settings,
      outlines,
      chapters: chapterItems,
      facts: factItems,
      characters: characterItems,
      maps: mapItems,
      summary: {
        settingsChanged: settings.filter((item) => item.status !== 'same').length,
        outlinesChanged: outlines.filter((item) => item.status !== 'same').length,
        chaptersChanged: chapterItems.filter((item) => item.status !== 'same').length,
        factsChanged: factItems.filter((item) => item.status !== 'same').length,
        charactersChanged: characterItems.filter((item) => item.status !== 'same').length,
        mapsChanged: mapItems.filter((item) => item.status !== 'same').length,
        conflicts: allItems.filter((item) => item.conflict).length,
      },
    };
  }

  async cherryPick(
    userId: string,
    workId: string,
    sourceBranchId: string,
    input: CherryPickInput,
  ): Promise<CherryPickResult> {
    const logicalSourceBranchId = await this.branchState.logicalBranchId(sourceBranchId);
    const logicalTargetBranchId = await this.branchState.logicalBranchId(input.targetBranchId);
    const source = await this.requireBranch(userId, workId, logicalSourceBranchId);
    const target = await this.requireBranch(userId, workId, logicalTargetBranchId);
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
    const sourceReadId = await this.branchState.effectiveReadBranchId(source.branch.id);
    const items: CherryPickResult['items'] = [];
    for (const item of input.items) {
      items.push(
        await this.pickOne(
          userId,
          workId,
          source.branch,
          sourceReadId,
          target.branch,
          item.type,
          item.id,
        ),
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

  private async resolveVersionPoint(
    workId: string,
    sourceBranchId: string,
    versionPointId: string,
  ): Promise<VersionPoint & { baselineBranchId: string }> {
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
        baselineBranchId: await this.branchState.effectiveReadBranchId(sourceBranchId),
      };
    }

    const [row] = await this.database.db
      .select({
        commit: branchCommits,
        chapter: chapters,
        version: chapterVersions,
        outlineTitle: chapterOutlines.title,
      })
      .from(branchCommits)
      .innerJoin(chapterVersions, eq(chapterVersions.id, branchCommits.chapterVersionId))
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
        and(eq(branchCommits.workId, workId), eq(branchCommits.chapterVersionId, versionPointId)),
      )
      .limit(1);
    if (!row) {
      throw branchesError(
        HttpStatus.NOT_FOUND,
        'VERSION_POINT_NOT_RECONSTRUCTABLE',
        'This version point does not have a complete story-state snapshot',
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
      baselineBranchId: row.commit.snapshotBranchId,
    };
  }

  private async buildForkSnapshot(
    workId: string,
    branchId: string,
  ): Promise<WorkBranchForkSnapshotValue> {
    const [entityRows, outlineRows, chapterRows, factRows, characterRows, mapRows] =
      await Promise.all([
        this.loadEntities(workId, branchId),
        this.loadOutlines(workId, branchId),
        this.loadChaptersWithContent(workId, branchId),
        this.loadFacts(workId, branchId),
        this.loadCharacterStates(workId, branchId),
        this.loadMaps(workId, branchId),
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
        chapterRows.map((row) => [String(row.chapter.chapterNumber), this.chapterFingerprint(row)]),
      ),
      facts: Object.fromEntries(
        factRows.map((row) => [
          `${row.fact.type}:${row.fact.statement}`,
          this.factFingerprint(row),
        ]),
      ),
      characters: Object.fromEntries(
        characterRows.map((row) => [row.name, this.characterFingerprint(row)]),
      ),
      maps: Object.fromEntries(mapRows.map((row) => [row.name, this.mapFingerprint(row)])),
    };
  }

  private async pickOne(
    userId: string,
    workId: string,
    sourceBranch: WorkBranchRow,
    sourceReadId: string,
    targetBranch: WorkBranchRow,
    type: CherryPickInput['items'][number]['type'],
    id: string,
  ): Promise<CherryPickResult['items'][number]> {
    try {
      if (type === 'chapter') {
        return await this.pickChapter(userId, workId, sourceBranch, sourceReadId, targetBranch, id);
      }
      if (type === 'setting') {
        return await this.pickSetting(userId, workId, sourceBranch, sourceReadId, targetBranch, id);
      }
      return await this.pickOutline(userId, workId, sourceBranch, sourceReadId, targetBranch, id);
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
    sourceReadId: string,
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
          eq(chapters.branchId, sourceReadId),
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
      sourceBranch,
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
    sourceReadId: string,
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
          eq(entities.branchId, sourceReadId),
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
      sourceBranch,
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
    sourceReadId: string,
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
          eq(chapterOutlines.branchId, sourceReadId),
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
      sourceBranch,
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
    sourceBranch: WorkBranchRow,
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
    if (
      analyzed.impact?.classification === 'safe' ||
      analyzed.impact?.classification === 'repairable'
    ) {
      const applied = await this.changes.apply(
        userId,
        workId,
        targetBranchId,
        created.id,
        {
          mode: analyzed.impact.classification === 'repairable' ? 'repair' : 'apply',
          ...(analyzed.impact.classification === 'repairable'
            ? { repairNotes: '作者明确选择只摘取这一项，影响范围已记录在修改请求中。' }
            : {}),
        },
        {
          kind: 'merge',
          title: title,
          reason: reason,
          metadata: {
            sourceBranchId: sourceBranch.id,
            sourceBranchName: sourceBranch.name,
          },
        },
      );
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

  private factFingerprint(row: { fact: typeof facts.$inferSelect; chapterNumber: number }): string {
    return this.fingerprint({
      statement: row.fact.statement,
      sourceSentence: row.fact.sourceSentence,
      type: row.fact.type,
      chapterNumber: row.chapterNumber,
    });
  }

  private characterFingerprint(row: {
    state: typeof characterStates.$inferSelect;
    name: string;
  }): string {
    return this.fingerprint({
      body: row.state.body,
      power: row.state.power,
      location: row.state.location,
      possessions: row.state.possessions,
      disguise: row.state.disguise,
      knowledge: row.state.knowledge,
    });
  }

  private mapFingerprint(row: { node: typeof mapNodes.$inferSelect; name: string }): string {
    return this.fingerprint({ name: row.name, level: row.node.level });
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

  private async loadFacts(workId: string, branchId: string) {
    return this.database.db
      .select({ fact: facts, chapterNumber: chapters.chapterNumber })
      .from(facts)
      .innerJoin(chapters, eq(chapters.id, facts.chapterId))
      .where(and(eq(facts.workId, workId), eq(facts.branchId, branchId)))
      .orderBy(asc(chapters.chapterNumber));
  }

  private async loadCharacterStates(workId: string, branchId: string) {
    return this.database.db
      .select({ state: characterStates, name: entities.name })
      .from(characterStates)
      .innerJoin(entities, eq(entities.id, characterStates.characterId))
      .where(
        and(
          eq(characterStates.workId, workId),
          eq(characterStates.branchId, branchId),
          isNull(entities.deletedAt),
        ),
      )
      .orderBy(asc(entities.name));
  }

  private async loadMaps(workId: string, branchId: string) {
    return this.database.db
      .select({ node: mapNodes, name: entities.name })
      .from(mapNodes)
      .innerJoin(entities, eq(entities.id, mapNodes.entityId))
      .where(
        and(
          eq(mapNodes.workId, workId),
          eq(mapNodes.branchId, branchId),
          isNull(entities.deletedAt),
        ),
      )
      .orderBy(asc(entities.name));
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

const FACT_FIELDS = [
  { field: 'statement', label: '已确认内容' },
  { field: 'sourceSentence', label: '来源原句' },
  { field: 'type', label: '类型' },
];

const CHARACTER_FIELDS = [
  { field: 'body', label: '身体状态' },
  { field: 'power', label: '力量' },
  { field: 'location', label: '位置' },
  { field: 'possessions', label: '持有物' },
  { field: 'disguise', label: '伪装' },
  { field: 'knowledge', label: '人物认知' },
];

const MAP_FIELDS = [{ field: 'level', label: '地点层级' }];

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
