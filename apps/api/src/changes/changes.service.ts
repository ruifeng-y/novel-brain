import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CHANGE_CLASSIFICATION_LABELS,
  CHANGE_REQUEST_STATUS_LABELS,
  CHANGE_RISK_LABELS,
  CHANGE_SOURCE_LABELS,
  CHANGE_TARGET_TYPE_LABELS,
  countCjkCharacters,
  type ApplyChangeRequestInput,
  type BranchChangeRequestInput,
  type CancelChangeRequestInput,
  type ChangeDiffEntry,
  type CreateChangeRequestInput,
  type FalsePositiveInput,
} from '@novel/contracts';
import {
  analyzeChangeImpact,
  type ChangeAffected,
  type ChangeCheck,
  type ChangeClassification,
  type ChangeImpactInput,
} from '@novel/core';
import {
  changeImpactReports,
  changeRequests,
  changeValidations,
  chapterOutlines,
  chapters,
  chapterVersions,
  characterStates,
  entities,
  entityRelations,
  facts,
  mapNodes,
  storyBibles,
  storyThreads,
  timelineEventNodes,
  workBranches,
  works,
  type ChangeRequestRow,
  type ChangeValidationRow,
} from '@novel/db';
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { changesError } from './changes.errors';

type ChangeDatabase = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type ChangeCheckStep = (typeof changeValidations.$inferSelect)['step'];

type ResolvedTarget = {
  id: string | null;
  label: string;
  status: string;
  locked: boolean;
};

type ChangeTargetOption = {
  type: keyof typeof CHANGE_TARGET_TYPE_LABELS;
  typeLabel: string;
  id: string | null;
  label: string;
  detail: string;
  status: string;
};

type ChangeResponse = {
  id: string;
  workId: string;
  branchId: string;
  targetType: keyof typeof CHANGE_TARGET_TYPE_LABELS;
  targetTypeLabel: string;
  targetId: string | null;
  targetLabel: string;
  title: string;
  reason: string;
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  diff: ChangeDiffEntry[];
  source: keyof typeof CHANGE_SOURCE_LABELS;
  sourceLabel: string;
  risk: keyof typeof CHANGE_RISK_LABELS;
  riskLabel: string;
  status: keyof typeof CHANGE_REQUEST_STATUS_LABELS;
  statusLabel: string;
  branchedBranchId: string | null;
  decisionReason: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  impact: {
    id: string;
    classification: ChangeClassification;
    classificationLabel: string;
    confidence: number;
    summary: string;
    suggestions: string[];
    affected: ChangeAffected;
    checks: Array<ChangeCheck & { id: string; ignored: boolean; ignoredReason: string | null }>;
  } | null;
};

const CHECK_ORDER: ChangeCheckStep[] = [
  'structure',
  'hard_rules',
  'fact_diff',
  'knowledge_pov',
  'narrative',
  'downstream',
];

@Injectable()
export class ChangesService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<{ items: ChangeResponse[] }> {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select()
      .from(changeRequests)
      .where(and(eq(changeRequests.workId, workId), eq(changeRequests.branchId, branchId)))
      .orderBy(desc(changeRequests.updatedAt));
    return {
      items: await Promise.all(rows.map((row) => this.toResponse(userId, workId, branchId, row))),
    };
  }

  async get(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
  ): Promise<ChangeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.requireChange(workId, branchId, changeId);
    return this.toResponse(userId, workId, branchId, row);
  }

  async targets(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<{ items: ChangeTargetOption[] }> {
    const branch = await this.requireBranch(userId, workId, branchId);
    const [
      entityRows,
      outlineRows,
      chapterRows,
      factRows,
      characterRows,
      threadRows,
      mapRows,
      timelineRows,
      bibleRows,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            isNull(entities.deletedAt),
          ),
        )
        .orderBy(asc(entities.name)),
      this.database.db
        .select()
        .from(chapterOutlines)
        .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId)))
        .orderBy(asc(chapterOutlines.orderIndex), asc(chapterOutlines.createdAt)),
      this.database.db
        .select()
        .from(chapters)
        .where(and(eq(chapters.workId, workId), eq(chapters.branchId, branchId)))
        .orderBy(asc(chapters.chapterNumber)),
      this.database.db
        .select({ fact: facts, chapterNumber: chapters.chapterNumber })
        .from(facts)
        .innerJoin(chapters, eq(chapters.id, facts.chapterId))
        .where(and(eq(facts.workId, workId), eq(facts.branchId, branchId)))
        .orderBy(asc(chapters.chapterNumber), asc(facts.createdAt)),
      this.database.db
        .select({ state: characterStates, name: entities.name })
        .from(characterStates)
        .innerJoin(entities, eq(entities.id, characterStates.characterId))
        .where(and(eq(characterStates.workId, workId), eq(characterStates.branchId, branchId)))
        .orderBy(asc(entities.name)),
      this.database.db
        .select()
        .from(storyThreads)
        .where(and(eq(storyThreads.workId, workId), eq(storyThreads.branchId, branchId)))
        .orderBy(asc(storyThreads.name)),
      this.database.db
        .select({ node: mapNodes, name: entities.name, summary: entities.summary })
        .from(mapNodes)
        .innerJoin(entities, eq(entities.id, mapNodes.entityId))
        .where(and(eq(mapNodes.workId, workId), eq(mapNodes.branchId, branchId)))
        .orderBy(asc(entities.name)),
      this.database.db
        .select({ node: timelineEventNodes, name: entities.name })
        .from(timelineEventNodes)
        .innerJoin(entities, eq(entities.id, timelineEventNodes.timelineEntityId))
        .where(
          and(eq(timelineEventNodes.workId, workId), eq(timelineEventNodes.branchId, branchId)),
        )
        .orderBy(asc(timelineEventNodes.orderIndex), asc(timelineEventNodes.createdAt)),
      this.database.db
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)))
        .limit(1),
    ]);

    const items: ChangeTargetOption[] = [];
    for (const entity of entityRows) {
      items.push(
        this.targetOption('entity', entity.id, entity.name, entity.summary, entity.status),
      );
      if (entity.type === 'faction') {
        items.push(
          this.targetOption('faction', entity.id, entity.name, entity.summary, entity.status),
        );
      }
      if (entity.type === 'map') {
        items.push(this.targetOption('map', entity.id, entity.name, entity.summary, entity.status));
      }
      if (entity.type === 'power_system' || entity.type === 'item_technique') {
        items.push(
          this.targetOption('power_item', entity.id, entity.name, entity.summary, entity.status),
        );
      }
    }
    for (const outline of outlineRows) {
      items.push(
        this.targetOption(
          'outline',
          outline.id,
          outline.chapterNumber
            ? `第 ${outline.chapterNumber} 章 · ${outline.title}`
            : outline.title,
          outline.chapterGoal || outline.summary || outline.details,
          outline.lockedAt ? 'locked' : 'draft',
        ),
      );
    }
    for (const chapter of chapterRows) {
      items.push(
        this.targetOption(
          'chapter',
          chapter.id,
          `第 ${chapter.chapterNumber} 章 · ${chapter.title}`,
          chapter.summary || chapter.hook,
          chapter.status,
        ),
      );
    }
    for (const row of factRows) {
      items.push(
        this.targetOption(
          'fact',
          row.fact.id,
          `第 ${row.chapterNumber} 章 · ${row.fact.statement}`,
          row.fact.sourceSentence,
          'confirmed',
        ),
      );
    }
    for (const row of characterRows) {
      if (row.state.knowledge.length === 0) {
        continue;
      }
      items.push(
        this.targetOption(
          'knowledge',
          row.state.characterId,
          row.name,
          `${row.state.knowledge.length} 条认知 · ${row.state.knowledge.map((item) => item.title).join('、')}`,
          'draft',
        ),
      );
    }
    for (const thread of threadRows) {
      items.push(
        this.targetOption(
          'plot_line',
          thread.id,
          thread.name,
          thread.summary || thread.stakes,
          thread.status,
        ),
      );
    }
    for (const row of mapRows) {
      items.push(
        this.targetOption(
          'map',
          row.node.entityId,
          row.name,
          row.summary || `地图层级：${row.node.level}`,
          'draft',
        ),
      );
    }
    for (const row of timelineRows) {
      items.push(
        this.targetOption(
          'timeline',
          row.node.id,
          row.node.title,
          row.node.summary || row.name,
          'draft',
        ),
      );
    }
    if (bibleRows[0]) {
      items.push(
        this.targetOption(
          'story_bible',
          null,
          '故事圣经',
          bibleRows[0].oneSentenceStory || bibleRows[0].protagonist || '全书故事方向',
          bibleRows[0].lockedAt ? 'locked' : 'draft',
        ),
      );
    }
    items.push(
      this.targetOption(
        'work',
        null,
        branch.work.title,
        `${branch.work.penName} · ${branch.work.targetPlatform}`,
        branch.work.status,
      ),
    );
    return {
      items: [
        ...new Map(items.map((item) => [`${item.type}:${item.id ?? 'branch'}`, item])).values(),
      ],
    };
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: CreateChangeRequestInput,
  ): Promise<ChangeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const target = await this.resolveTarget(
      workId,
      branchId,
      input.targetType,
      input.targetId ?? null,
    );
    const diff = this.diffValues(input.oldValue, input.newValue);
    if (diff.length === 0) {
      throw changesError(
        HttpStatus.BAD_REQUEST,
        'CHANGE_DIFF_EMPTY',
        'Change at least one field before creating a change request',
      );
    }

    const now = new Date();
    const [created] = await this.database.db
      .insert(changeRequests)
      .values({
        workId,
        branchId,
        targetType: input.targetType,
        targetId: target.id,
        title: input.title,
        reason: input.reason,
        oldValue: input.oldValue,
        newValue: input.newValue,
        diff,
        source: input.source,
        risk: input.risk,
        status: 'draft',
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.touchWork(workId, now);
    return this.toResponse(userId, workId, branchId, created);
  }

  async analyze(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
  ): Promise<ChangeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const requested = await this.requireChange(workId, branchId, changeId);
    if (this.isSettled(requested.status)) {
      throw changesError(
        HttpStatus.CONFLICT,
        'CHANGE_ALREADY_SETTLED',
        'This change has already been settled',
      );
    }

    const [row] = await this.database.db
      .update(changeRequests)
      .set({ status: 'analyzing', updatedAt: new Date() })
      .where(eq(changeRequests.id, requested.id))
      .returning();
    const target = await this.resolveTarget(workId, branchId, row.targetType, row.targetId);
    const snapshot = await this.loadSnapshot(workId, branchId);
    const result = analyzeChangeImpact({
      change: {
        title: row.title,
        reason: row.reason,
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel: target.label,
        targetStatus: target.status,
        targetLocked: target.locked,
        before: row.oldValue,
        after: row.newValue,
        source: row.source,
        risk: row.risk,
      },
      snapshot,
    });
    const now = new Date();

    await this.database.db.transaction(async (tx) => {
      await tx
        .insert(changeImpactReports)
        .values({
          changeRequestId: row.id,
          affected: result.affected,
          classification: result.classification,
          confidence: result.confidence,
          summary: result.summary,
          suggestions: result.suggestions,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: changeImpactReports.changeRequestId,
          set: {
            affected: result.affected,
            classification: result.classification,
            confidence: result.confidence,
            summary: result.summary,
            suggestions: result.suggestions,
            updatedAt: now,
          },
        });
      for (const check of result.checks) {
        await tx
          .insert(changeValidations)
          .values({
            changeRequestId: row.id,
            step: check.step,
            status: check.status,
            summary: check.summary,
            suggestion: check.suggestion,
            confidence: check.confidence,
            ignored: false,
            ignoredReason: null,
            ignoredAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [changeValidations.changeRequestId, changeValidations.step],
            set: {
              status: check.status,
              summary: check.summary,
              suggestion: check.suggestion,
              confidence: check.confidence,
              ignored: false,
              ignoredReason: null,
              ignoredAt: null,
              updatedAt: now,
            },
          });
      }
      await tx
        .update(changeRequests)
        .set({ status: 'waiting_confirmation', updatedAt: now })
        .where(eq(changeRequests.id, row.id));
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
    });
    return this.get(userId, workId, branchId, changeId);
  }

  async apply(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
    input: ApplyChangeRequestInput,
  ): Promise<ChangeResponse> {
    await this.requireBranch(userId, workId, branchId);
    let row = await this.requireChange(workId, branchId, changeId);
    if (this.isSettled(row.status)) {
      throw changesError(
        HttpStatus.CONFLICT,
        'CHANGE_ALREADY_SETTLED',
        'This change has already been settled',
      );
    }
    if (row.status !== 'waiting_confirmation') {
      await this.analyze(userId, workId, branchId, changeId);
      row = await this.requireChange(workId, branchId, changeId);
    }
    const [report] = await this.database.db
      .select()
      .from(changeImpactReports)
      .where(eq(changeImpactReports.changeRequestId, row.id))
      .limit(1);
    if (!report) {
      throw changesError(
        HttpStatus.CONFLICT,
        'CHANGE_ANALYSIS_REQUIRED',
        'Analyze this change before applying it',
      );
    }
    if (report.classification === 'structural') {
      throw changesError(
        HttpStatus.CONFLICT,
        'CHANGE_STRUCTURAL_BRANCH_REQUIRED',
        'This change affects locked or published story content. Create a parallel version instead.',
        { classification: report.classification },
      );
    }
    if (report.classification === 'repairable' && input.mode !== 'repair') {
      throw changesError(
        HttpStatus.CONFLICT,
        'CHANGE_REPAIR_REQUIRED',
        'Repair the affected story content and confirm the repair before applying this change',
        { classification: report.classification },
      );
    }

    const now = new Date();
    await this.database.db
      .update(changeRequests)
      .set({ status: 'applying', updatedAt: now })
      .where(eq(changeRequests.id, row.id));
    try {
      await this.database.db.transaction(async (tx) => {
        await this.applyTarget(tx, userId, workId, branchId, row, input.repairNotes);
        await tx
          .update(changeRequests)
          .set({
            status: 'applied',
            appliedAt: now,
            decisionReason: input.repairNotes ?? row.reason,
            updatedAt: now,
          })
          .where(eq(changeRequests.id, row.id));
        await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
      });
    } catch (error) {
      await this.database.db
        .update(changeRequests)
        .set({
          status: 'failed',
          decisionReason: error instanceof Error ? error.message : 'Change could not be applied',
          updatedAt: new Date(),
        })
        .where(eq(changeRequests.id, row.id));
      throw error;
    }
    return this.get(userId, workId, branchId, changeId);
  }

  async branch(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
    input: BranchChangeRequestInput,
  ): Promise<ChangeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.requireChange(workId, branchId, changeId);
    if (row.status === 'applied' || row.status === 'branched') {
      throw changesError(
        HttpStatus.CONFLICT,
        'CHANGE_ALREADY_SETTLED',
        'This change has already been applied or moved to another version',
      );
    }
    const [existing] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.workId, workId), eq(workBranches.name, input.name)))
      .limit(1);
    if (existing) {
      throw changesError(
        HttpStatus.CONFLICT,
        'CHANGE_BRANCH_NAME_CONFLICT',
        'A parallel version with this name already exists',
      );
    }
    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      const [branch] = await tx
        .insert(workBranches)
        .values({
          workId,
          name: input.name,
          isMain: false,
          parentBranchId: branchId,
          status: 'active',
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx
        .update(changeRequests)
        .set({
          status: 'branched',
          branchedBranchId: branch.id,
          decisionReason: `为结构性修改新建平行版本：${input.name}`,
          updatedAt: now,
        })
        .where(eq(changeRequests.id, row.id));
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
    });
    return this.get(userId, workId, branchId, changeId);
  }

  async cancel(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
    input: CancelChangeRequestInput,
  ): Promise<ChangeResponse> {
    return this.settleWithoutApply(userId, workId, branchId, changeId, 'canceled', input.reason);
  }

  async reject(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
    input: CancelChangeRequestInput,
  ): Promise<ChangeResponse> {
    return this.settleWithoutApply(userId, workId, branchId, changeId, 'rejected', input.reason);
  }

  async ignoreFalsePositive(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
    input: FalsePositiveInput,
  ): Promise<ChangeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.requireChange(workId, branchId, changeId);
    const [validation] = await this.database.db
      .select()
      .from(changeValidations)
      .where(
        and(
          eq(changeValidations.id, input.validationId),
          eq(changeValidations.changeRequestId, row.id),
        ),
      )
      .limit(1);
    if (!validation) {
      throw changesError(
        HttpStatus.NOT_FOUND,
        'CHANGE_VALIDATION_NOT_FOUND',
        'Validation result not found',
      );
    }
    const now = new Date();
    await this.database.db
      .update(changeValidations)
      .set({
        ignored: true,
        ignoredReason: input.reason,
        ignoredAt: now,
        updatedAt: now,
      })
      .where(eq(changeValidations.id, validation.id));
    const validations = await this.database.db
      .select()
      .from(changeValidations)
      .where(eq(changeValidations.changeRequestId, row.id));
    const active = validations.filter((item) => !item.ignored);
    const classification: ChangeClassification = active.some((item) => item.status === 'conflict')
      ? 'structural'
      : active.some((item) => item.status === 'warning')
        ? 'repairable'
        : 'safe';
    const summary =
      classification === 'structural'
        ? '忽略误报后，仍有内容需要另开平行版本处理。'
        : classification === 'repairable'
          ? '忽略误报后，仍需修复相关章节或设定再应用。'
          : '误报已记录，当前修改可以直接应用。';
    const suggestions = active
      .filter((item) => item.status !== 'passed')
      .map((item) => item.suggestion);
    await this.database.db
      .update(changeImpactReports)
      .set({
        classification,
        summary,
        suggestions:
          suggestions.length > 0 ? suggestions : ['应用后保留版本记录，继续按现有内容写作。'],
        updatedAt: now,
      })
      .where(eq(changeImpactReports.changeRequestId, row.id));
    return this.get(userId, workId, branchId, changeId);
  }

  private async settleWithoutApply(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
    status: 'canceled' | 'rejected',
    reason: string | undefined,
  ): Promise<ChangeResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.requireChange(workId, branchId, changeId);
    if (row.status === 'applied' || row.status === 'branched') {
      throw changesError(
        HttpStatus.CONFLICT,
        'CHANGE_ALREADY_SETTLED',
        'This change has already been applied or moved to another version',
      );
    }
    const now = new Date();
    await this.database.db
      .update(changeRequests)
      .set({
        status,
        canceledAt: status === 'canceled' ? now : null,
        rejectedAt: status === 'rejected' ? now : null,
        decisionReason: reason ?? null,
        updatedAt: now,
      })
      .where(eq(changeRequests.id, row.id));
    return this.get(userId, workId, branchId, changeId);
  }

  private async toResponse(
    _userId: string,
    workId: string,
    branchId: string,
    row: ChangeRequestRow,
  ): Promise<ChangeResponse> {
    const target = await this.resolveTarget(workId, branchId, row.targetType, row.targetId);
    const [[impact], validations] = await Promise.all([
      this.database.db
        .select()
        .from(changeImpactReports)
        .where(eq(changeImpactReports.changeRequestId, row.id))
        .limit(1),
      this.database.db
        .select()
        .from(changeValidations)
        .where(eq(changeValidations.changeRequestId, row.id)),
    ]);
    const checks = validations
      .map((validation) => this.toCheck(validation))
      .sort((left, right) => CHECK_ORDER.indexOf(left.step) - CHECK_ORDER.indexOf(right.step));
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      targetType: row.targetType,
      targetTypeLabel: CHANGE_TARGET_TYPE_LABELS[row.targetType],
      targetId: row.targetId,
      targetLabel: target.label,
      title: row.title,
      reason: row.reason,
      oldValue: row.oldValue,
      newValue: row.newValue,
      diff: row.diff,
      source: row.source,
      sourceLabel: CHANGE_SOURCE_LABELS[row.source],
      risk: row.risk,
      riskLabel: CHANGE_RISK_LABELS[row.risk],
      status: row.status,
      statusLabel: CHANGE_REQUEST_STATUS_LABELS[row.status],
      branchedBranchId: row.branchedBranchId,
      decisionReason: row.decisionReason,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      impact: impact
        ? {
            id: impact.id,
            classification: impact.classification,
            classificationLabel: CHANGE_CLASSIFICATION_LABELS[impact.classification],
            confidence: impact.confidence,
            summary: impact.summary,
            suggestions: impact.suggestions,
            affected: impact.affected as ChangeAffected,
            checks,
          }
        : null,
    };
  }

  private toCheck(
    validation: ChangeValidationRow,
  ): ChangeCheck & { id: string; ignored: boolean; ignoredReason: string | null } {
    return {
      id: validation.id,
      step: validation.step,
      label: this.checkLabel(validation.step),
      status: validation.status,
      statusLabel:
        validation.status === 'conflict'
          ? '存在冲突'
          : validation.status === 'warning'
            ? '需要处理'
            : '通过',
      summary: validation.summary,
      suggestion: validation.suggestion,
      confidence: validation.confidence,
      ignored: validation.ignored,
      ignoredReason: validation.ignoredReason,
    };
  }

  private checkLabel(step: ChangeCheckStep): string {
    return {
      structure: '结构检查',
      hard_rules: '硬规则检查',
      fact_diff: '事实差异',
      knowledge_pov: '知识与视角',
      narrative: '叙事检查',
      downstream: '后续影响',
    }[step];
  }

  private targetOption(
    type: ChangeTargetOption['type'],
    id: string | null,
    label: string,
    detail: string,
    status: string,
  ): ChangeTargetOption {
    return {
      type,
      typeLabel: CHANGE_TARGET_TYPE_LABELS[type],
      id,
      label,
      detail,
      status,
    };
  }

  private async resolveTarget(
    workId: string,
    branchId: string,
    targetType: keyof typeof CHANGE_TARGET_TYPE_LABELS,
    targetId: string | null,
  ): Promise<ResolvedTarget> {
    const [work] = await this.database.db
      .select()
      .from(works)
      .where(and(eq(works.id, workId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw changesError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    if (targetType === 'work') {
      return {
        id: null,
        label: work.title,
        status: work.status,
        locked: work.status === 'completed' || work.status === 'archived',
      };
    }
    if (targetType === 'story_bible') {
      const [bible] = await this.database.db
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)))
        .limit(1);
      if (!bible) {
        throw changesError(
          HttpStatus.NOT_FOUND,
          'CHANGE_TARGET_NOT_FOUND',
          'Story bible not found',
        );
      }
      return {
        id: null,
        label: '故事圣经',
        status: bible.lockedAt ? 'locked' : 'draft',
        locked: bible.lockedAt !== null,
      };
    }
    if (!targetId) {
      throw changesError(
        HttpStatus.NOT_FOUND,
        'CHANGE_TARGET_NOT_FOUND',
        'Change target not found',
      );
    }
    if (targetType === 'outline') {
      const [outline] = await this.database.db
        .select()
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.id, targetId),
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branchId),
          ),
        )
        .limit(1);
      if (!outline) {
        throw changesError(
          HttpStatus.NOT_FOUND,
          'CHANGE_TARGET_NOT_FOUND',
          'Outline node not found',
        );
      }
      return {
        id: outline.id,
        label: outline.chapterNumber
          ? `第 ${outline.chapterNumber} 章 · ${outline.title}`
          : outline.title,
        status: outline.lockedAt ? 'locked' : 'draft',
        locked: outline.lockedAt !== null,
      };
    }
    if (targetType === 'chapter') {
      const [chapter] = await this.database.db
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.id, targetId),
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
          ),
        )
        .limit(1);
      if (!chapter) {
        throw changesError(HttpStatus.NOT_FOUND, 'CHANGE_TARGET_NOT_FOUND', 'Chapter not found');
      }
      return {
        id: chapter.id,
        label: `第 ${chapter.chapterNumber} 章 · ${chapter.title}`,
        status: chapter.status,
        locked: chapter.status === 'locked' || chapter.status === 'published',
      };
    }
    if (targetType === 'fact') {
      const [row] = await this.database.db
        .select({ fact: facts, chapterNumber: chapters.chapterNumber })
        .from(facts)
        .innerJoin(chapters, eq(chapters.id, facts.chapterId))
        .where(and(eq(facts.id, targetId), eq(facts.workId, workId), eq(facts.branchId, branchId)))
        .limit(1);
      if (!row) {
        throw changesError(
          HttpStatus.NOT_FOUND,
          'CHANGE_TARGET_NOT_FOUND',
          'Confirmed fact not found',
        );
      }
      return {
        id: row.fact.id,
        label: `第 ${row.chapterNumber} 章 · ${row.fact.statement}`,
        status: 'confirmed',
        locked: false,
      };
    }
    if (targetType === 'plot_line') {
      const [thread] = await this.database.db
        .select()
        .from(storyThreads)
        .where(
          and(
            eq(storyThreads.id, targetId),
            eq(storyThreads.workId, workId),
            eq(storyThreads.branchId, branchId),
          ),
        )
        .limit(1);
      if (!thread) {
        throw changesError(HttpStatus.NOT_FOUND, 'CHANGE_TARGET_NOT_FOUND', 'Plot line not found');
      }
      return {
        id: thread.id,
        label: thread.name,
        status: thread.status,
        locked: false,
      };
    }
    if (targetType === 'timeline') {
      const [node] = await this.database.db
        .select()
        .from(timelineEventNodes)
        .where(
          and(
            eq(timelineEventNodes.id, targetId),
            eq(timelineEventNodes.workId, workId),
            eq(timelineEventNodes.branchId, branchId),
          ),
        )
        .limit(1);
      if (!node) {
        throw changesError(
          HttpStatus.NOT_FOUND,
          'CHANGE_TARGET_NOT_FOUND',
          'Timeline event not found',
        );
      }
      return {
        id: node.id,
        label: node.title,
        status: 'draft',
        locked: false,
      };
    }
    if (targetType === 'knowledge') {
      const [row] = await this.database.db
        .select({ state: characterStates, name: entities.name })
        .from(characterStates)
        .innerJoin(entities, eq(entities.id, characterStates.characterId))
        .where(
          and(
            eq(characterStates.characterId, targetId),
            eq(characterStates.workId, workId),
            eq(characterStates.branchId, branchId),
          ),
        )
        .limit(1);
      if (!row) {
        throw changesError(
          HttpStatus.NOT_FOUND,
          'CHANGE_TARGET_NOT_FOUND',
          'Character knowledge not found',
        );
      }
      return {
        id: row.state.characterId,
        label: row.name,
        status: 'draft',
        locked: false,
      };
    }
    if (targetType === 'map') {
      const [node] = await this.database.db
        .select({ node: mapNodes, name: entities.name })
        .from(mapNodes)
        .innerJoin(entities, eq(entities.id, mapNodes.entityId))
        .where(
          and(
            eq(mapNodes.workId, workId),
            eq(mapNodes.branchId, branchId),
            eq(mapNodes.entityId, targetId),
          ),
        )
        .limit(1);
      if (node) {
        return {
          id: node.node.entityId,
          label: node.name,
          status: 'draft',
          locked: false,
        };
      }
    }
    const [entity] = await this.database.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, targetId),
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    if (!entity) {
      throw changesError(
        HttpStatus.NOT_FOUND,
        'CHANGE_TARGET_NOT_FOUND',
        'Change target not found',
      );
    }
    if (targetType === 'faction' && entity.type !== 'faction') {
      throw changesError(HttpStatus.NOT_FOUND, 'CHANGE_TARGET_NOT_FOUND', 'Faction not found');
    }
    if (
      targetType === 'power_item' &&
      entity.type !== 'power_system' &&
      entity.type !== 'item_technique'
    ) {
      throw changesError(
        HttpStatus.NOT_FOUND,
        'CHANGE_TARGET_NOT_FOUND',
        'Power system or item not found',
      );
    }
    return {
      id: entity.id,
      label: entity.name,
      status: entity.status,
      locked: entity.status === 'locked',
    };
  }

  private async loadSnapshot(
    workId: string,
    branchId: string,
  ): Promise<ChangeImpactInput['snapshot']> {
    const [
      bibleRows,
      entityRows,
      factRows,
      chapterRows,
      outlineRows,
      threadRows,
      knowledgeRows,
      mapRows,
      relationRows,
      powerRows,
      timelineRows,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)))
        .limit(1),
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
        .select({ fact: facts, chapterNumber: chapters.chapterNumber })
        .from(facts)
        .innerJoin(chapters, eq(chapters.id, facts.chapterId))
        .where(and(eq(facts.workId, workId), eq(facts.branchId, branchId))),
      this.database.db
        .select({ chapter: chapters, content: chapterVersions.content })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(and(eq(chapters.workId, workId), eq(chapters.branchId, branchId))),
      this.database.db
        .select()
        .from(chapterOutlines)
        .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId))),
      this.database.db
        .select()
        .from(storyThreads)
        .where(and(eq(storyThreads.workId, workId), eq(storyThreads.branchId, branchId))),
      this.database.db
        .select({ state: characterStates, name: entities.name })
        .from(characterStates)
        .innerJoin(entities, eq(entities.id, characterStates.characterId))
        .where(and(eq(characterStates.workId, workId), eq(characterStates.branchId, branchId))),
      this.database.db
        .select({ node: mapNodes, name: entities.name })
        .from(mapNodes)
        .innerJoin(entities, eq(entities.id, mapNodes.entityId))
        .where(and(eq(mapNodes.workId, workId), eq(mapNodes.branchId, branchId))),
      this.database.db
        .select({
          relation: entityRelations,
          fromName: sql<string>`from_entity.name`,
          toName: sql<string>`to_entity.name`,
        })
        .from(entityRelations)
        .innerJoin(
          sql`entities as from_entity`,
          sql`from_entity.id = ${entityRelations.fromEntityId}`,
        )
        .innerJoin(sql`entities as to_entity`, sql`to_entity.id = ${entityRelations.toEntityId}`)
        .where(and(eq(entityRelations.workId, workId), eq(entityRelations.branchId, branchId))),
      this.database.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            inArray(entities.type, ['power_system', 'item_technique']),
            isNull(entities.deletedAt),
          ),
        ),
      this.database.db
        .select({ node: timelineEventNodes, name: entities.name })
        .from(timelineEventNodes)
        .innerJoin(entities, eq(entities.id, timelineEventNodes.timelineEntityId))
        .where(
          and(eq(timelineEventNodes.workId, workId), eq(timelineEventNodes.branchId, branchId)),
        ),
    ]);

    const bible = bibleRows[0];
    return {
      bible: {
        locked: Boolean(bible?.lockedAt),
        worldIronLaws: this.storyBibleWorldLaws(bible),
      },
      entities: entityRows.map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        status: entity.status,
        summary: entity.summary,
        aliases: entity.aliases,
      })),
      facts: factRows.map((row) => ({
        id: row.fact.id,
        statement: row.fact.statement,
        type: row.fact.type,
        chapterNumber: row.chapterNumber,
      })),
      chapters: chapterRows.map((row) => ({
        id: row.chapter.id,
        title: row.chapter.title,
        chapterNumber: row.chapter.chapterNumber,
        status: row.chapter.status,
        content: row.content ?? row.chapter.autosaveContent,
      })),
      outlines: outlineRows.map((outline) => ({
        id: outline.id,
        title: outline.title,
        chapterNumber: outline.chapterNumber,
        chapterGoal: outline.chapterGoal,
        sceneBeats: outline.sceneBeats,
        chapterEndHook: outline.chapterEndHook,
        locked: outline.lockedAt !== null,
      })),
      plotLines: threadRows.map((thread) => ({
        id: thread.id,
        name: thread.name,
        type: thread.type,
        status: thread.status,
        summary: thread.summary,
      })),
      knowledge: knowledgeRows.flatMap((row) =>
        row.state.knowledge.map((entry) => ({
          id: entry.id,
          characterId: row.state.characterId,
          characterName: row.name,
          title: entry.title,
          objectiveTruth: entry.objectiveTruth,
          characterBelief: entry.characterBelief,
        })),
      ),
      mapNodes: mapRows.map((row) => ({
        id: row.node.id,
        entityId: row.node.entityId,
        name: row.name,
        level: row.node.level,
      })),
      relations: relationRows.map((row) => ({
        id: row.relation.id,
        fromEntityId: row.relation.fromEntityId,
        fromName: row.fromName,
        predicate: row.relation.predicate,
        toEntityId: row.relation.toEntityId,
        toName: row.toName,
      })),
      powerItems: powerRows.map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        summary: entity.summary,
      })),
      timeline: timelineRows.map((row) => ({
        id: row.node.id,
        title: row.node.title,
        summary: row.node.summary,
        dateLabel: this.formatStoryDate(row.node.absoluteDate),
      })),
    };
  }

  private storyBibleWorldLaws(bible: typeof storyBibles.$inferSelect | undefined): string[] {
    if (!bible) {
      return [];
    }
    const card = bible.cards.find((item) => item.key === 'worldIronLaws');
    return [card?.summary, card?.details, bible.worldIronLaw].filter((value): value is string =>
      Boolean(value?.trim()),
    );
  }

  private formatStoryDate(
    value: { year: number; month?: number; day?: number; note: string } | null,
  ): string {
    if (!value) {
      return '';
    }
    return [
      `${value.year}年`,
      value.month === undefined ? '' : `${value.month}月`,
      value.day === undefined ? '' : `${value.day}日`,
      value.note ? `（${value.note}）` : '',
    ].join('');
  }

  private diffValues(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): ChangeDiffEntry[] {
    const fields = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    return fields
      .filter((field) => this.stableStringify(before[field]) !== this.stableStringify(after[field]))
      .map((field) => ({
        field,
        before: before[field] ?? null,
        after: after[field] ?? null,
      }));
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
      .join(',')}}`;
  }

  private async applyTarget(
    tx: ChangeDatabase,
    userId: string,
    workId: string,
    branchId: string,
    change: ChangeRequestRow,
    repairNotes: string | undefined,
  ): Promise<void> {
    const values = change.newValue;
    const now = new Date();
    if (
      change.targetType === 'entity' ||
      change.targetType === 'map' ||
      change.targetType === 'faction' ||
      change.targetType === 'power_item'
    ) {
      const changes = this.entityChanges(values, now);
      if (Object.keys(changes).length === 1) {
        throw changesError(
          HttpStatus.BAD_REQUEST,
          'CHANGE_FIELDS_UNSUPPORTED',
          'No supported setting fields were provided',
        );
      }
      const [updated] = await tx
        .update(entities)
        .set(changes)
        .where(
          and(
            eq(entities.id, change.targetId ?? ''),
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            isNull(entities.deletedAt),
          ),
        )
        .returning();
      if (!updated) {
        throw changesError(
          HttpStatus.NOT_FOUND,
          'CHANGE_TARGET_NOT_FOUND',
          'Change target not found',
        );
      }
      return;
    }
    if (change.targetType === 'outline') {
      const changes = {
        version: sql`${chapterOutlines.version} + 1`,
        updatedAt: now,
      } as unknown as Partial<typeof chapterOutlines.$inferInsert>;
      for (const key of [
        'title',
        'summary',
        'details',
        'chapterGoal',
        'pov',
        'chapterEndHook',
      ] as const) {
        if (typeof values[key] === 'string') {
          changes[key] = values[key] as never;
        }
      }
      if (typeof values.chapterNumber === 'number') {
        changes.chapterNumber = values.chapterNumber;
      }
      if (Array.isArray(values.sceneBeats)) {
        changes.sceneBeats = values.sceneBeats.filter(
          (item): item is string => typeof item === 'string',
        );
      }
      await tx
        .update(chapterOutlines)
        .set(changes)
        .where(
          and(
            eq(chapterOutlines.id, change.targetId ?? ''),
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branchId),
          ),
        );
      return;
    }
    if (change.targetType === 'chapter') {
      await this.applyChapterChange(tx, userId, workId, branchId, change, repairNotes, now);
      return;
    }
    if (change.targetType === 'fact') {
      const changes: Partial<typeof facts.$inferInsert> = {};
      if (typeof values.statement === 'string') {
        changes.statement = values.statement;
      }
      if (
        values.type === 'event' ||
        values.type === 'body_state' ||
        values.type === 'character_knowledge'
      ) {
        changes.type = values.type;
      }
      if (Object.keys(changes).length === 0) {
        throw changesError(
          HttpStatus.BAD_REQUEST,
          'CHANGE_FIELDS_UNSUPPORTED',
          'No supported confirmed-setting fields were provided',
        );
      }
      await tx
        .update(facts)
        .set(changes)
        .where(
          and(
            eq(facts.id, change.targetId ?? ''),
            eq(facts.workId, workId),
            eq(facts.branchId, branchId),
          ),
        );
      return;
    }
    if (change.targetType === 'knowledge') {
      const [state] = await tx
        .select()
        .from(characterStates)
        .where(
          and(
            eq(characterStates.characterId, change.targetId ?? ''),
            eq(characterStates.workId, workId),
            eq(characterStates.branchId, branchId),
          ),
        )
        .limit(1);
      if (!state || !Array.isArray(values.knowledge)) {
        throw changesError(
          HttpStatus.BAD_REQUEST,
          'CHANGE_FIELDS_UNSUPPORTED',
          'Provide the updated character knowledge entries',
        );
      }
      await tx
        .update(characterStates)
        .set({
          knowledge: values.knowledge as typeof characterStates.$inferInsert.knowledge,
          version: state.version + 1,
          updatedBy: userId,
          updatedAt: now,
        })
        .where(eq(characterStates.id, state.id));
      return;
    }
    if (change.targetType === 'plot_line') {
      const changes: Partial<typeof storyThreads.$inferInsert> = { updatedAt: now };
      for (const key of ['name', 'summary', 'stakes'] as const) {
        if (typeof values[key] === 'string') {
          changes[key] = values[key] as never;
        }
      }
      if (
        values.status === 'active' ||
        values.status === 'resolved' ||
        values.status === 'abandoned'
      ) {
        changes.status = values.status;
      }
      await tx
        .update(storyThreads)
        .set(changes)
        .where(
          and(
            eq(storyThreads.id, change.targetId ?? ''),
            eq(storyThreads.workId, workId),
            eq(storyThreads.branchId, branchId),
          ),
        );
      return;
    }
    if (change.targetType === 'timeline') {
      const changes: Partial<typeof timelineEventNodes.$inferInsert> = {
        updatedAt: now,
      };
      for (const key of ['title', 'summary', 'relativeTime'] as const) {
        if (typeof values[key] === 'string') {
          changes[key] = values[key] as never;
        }
      }
      if (typeof values.orderIndex === 'number') {
        changes.orderIndex = values.orderIndex;
      }
      await tx
        .update(timelineEventNodes)
        .set(changes)
        .where(
          and(
            eq(timelineEventNodes.id, change.targetId ?? ''),
            eq(timelineEventNodes.workId, workId),
            eq(timelineEventNodes.branchId, branchId),
          ),
        );
      return;
    }
    if (change.targetType === 'story_bible') {
      const changes = {
        version: sql`${storyBibles.version} + 1`,
        updatedAt: now,
      } as unknown as Partial<typeof storyBibles.$inferInsert>;
      for (const key of ['oneSentenceStory', 'protagonist', 'worldIronLaw'] as const) {
        if (typeof values[key] === 'string') {
          changes[key] = values[key] as never;
        }
      }
      if (Array.isArray(values.cards)) {
        changes.cards = values.cards as typeof storyBibles.$inferInsert.cards;
      }
      await tx
        .update(storyBibles)
        .set(changes)
        .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)));
      return;
    }
    if (change.targetType === 'work') {
      const changes: Partial<typeof works.$inferInsert> = { updatedAt: now };
      for (const key of ['title', 'penName', 'genrePack', 'scale', 'targetPlatform'] as const) {
        if (typeof values[key] === 'string') {
          changes[key] = values[key] as never;
        }
      }
      await tx.update(works).set(changes).where(eq(works.id, workId));
      return;
    }
    throw changesError(
      HttpStatus.BAD_REQUEST,
      'CHANGE_TARGET_UNSUPPORTED',
      'This change target cannot be applied automatically',
    );
  }

  private entityChanges(
    values: Record<string, unknown>,
    now: Date,
  ): Partial<typeof entities.$inferInsert> {
    const changes: Partial<typeof entities.$inferInsert> = { updatedAt: now };
    for (const key of ['name', 'summary', 'description', 'scope', 'status'] as const) {
      if (typeof values[key] === 'string') {
        changes[key] = values[key] as never;
      }
    }
    for (const key of ['aliases', 'tags'] as const) {
      if (Array.isArray(values[key])) {
        changes[key] = values[key].filter((item): item is string => typeof item === 'string');
      }
    }
    if (values.customFields && typeof values.customFields === 'object') {
      changes.customFields = values.customFields as typeof entities.$inferInsert.customFields;
    }
    return changes;
  }

  private async applyChapterChange(
    tx: ChangeDatabase,
    userId: string,
    workId: string,
    branchId: string,
    change: ChangeRequestRow,
    repairNotes: string | undefined,
    now: Date,
  ): Promise<void> {
    const [chapter] = await tx
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.id, change.targetId ?? ''),
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
        ),
      )
      .limit(1);
    if (!chapter) {
      throw changesError(HttpStatus.NOT_FOUND, 'CHANGE_TARGET_NOT_FOUND', 'Chapter not found');
    }
    const metadata: Partial<typeof chapters.$inferInsert> = {
      updatedAt: now,
    };
    for (const key of ['title', 'summary', 'hook'] as const) {
      if (typeof change.newValue[key] === 'string') {
        metadata[key] = change.newValue[key] as never;
      }
    }
    if (typeof change.newValue.content === 'string') {
      const content = change.newValue.content;
      const [versionRow] = await tx
        .select({ value: max(chapterVersions.version) })
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, chapter.id));
      const version = Number(versionRow?.value ?? 0) + 1;
      const wordCount = countCjkCharacters(content);
      const [created] = await tx
        .insert(chapterVersions)
        .values({
          chapterId: chapter.id,
          version,
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
          wordCount,
          createdBy: userId,
          source: 'manual',
          createdAt: now,
        })
        .returning();
      metadata.currentVersionId = created.id;
      metadata.wordCount = wordCount;
      metadata.autosaveContent = content;
      metadata.autosaveUpdatedAt = now;
    }
    if (Object.keys(metadata).length === 1 && !repairNotes) {
      throw changesError(
        HttpStatus.BAD_REQUEST,
        'CHANGE_FIELDS_UNSUPPORTED',
        'No supported chapter fields were provided',
      );
    }
    await tx.update(chapters).set(metadata).where(eq(chapters.id, chapter.id));
  }

  private async requireBranch(userId: string, workId: string, branchId: string) {
    const [row] = await this.database.db
      .select({ work: works, branch: workBranches })
      .from(works)
      .innerJoin(workBranches, eq(workBranches.workId, works.id))
      .where(
        and(
          eq(works.id, workId),
          eq(works.userId, userId),
          isNull(works.deletedAt),
          eq(workBranches.id, branchId),
        ),
      )
      .limit(1);
    if (!row) {
      const [work] = await this.database.db
        .select({ id: works.id })
        .from(works)
        .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
        .limit(1);
      if (!work) {
        throw changesError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
      }
      throw changesError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
    return row;
  }

  private async requireChange(
    workId: string,
    branchId: string,
    changeId: string,
  ): Promise<ChangeRequestRow> {
    const [row] = await this.database.db
      .select()
      .from(changeRequests)
      .where(
        and(
          eq(changeRequests.id, changeId),
          eq(changeRequests.workId, workId),
          eq(changeRequests.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row) {
      throw changesError(HttpStatus.NOT_FOUND, 'CHANGE_NOT_FOUND', 'Change request not found');
    }
    return row;
  }

  private isSettled(status: ChangeRequestRow['status']): boolean {
    return ['applied', 'branched', 'canceled', 'rejected'].includes(status);
  }

  private async touchWork(workId: string, now: Date): Promise<void> {
    await this.database.db.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
  }
}
