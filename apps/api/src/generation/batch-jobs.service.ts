import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BATCH_CHAPTER_STATUS_LABELS,
  BATCH_JOB_STATUS_LABELS,
  BATCH_REVIEW_STATUS_LABELS,
  type BatchJobReport,
  type BatchReviewDecision,
  type CreateBatchJobInput,
  type JobStatus,
} from '@novel/contracts';
import { transitionJobStatus } from '@novel/core';
import {
  annotations,
  chapterOutlines,
  chapterVersions,
  chapters,
  drafts,
  generationRequests,
  jobChapters,
  jobEvents,
  jobReports,
  jobSteps,
  jobs,
  qualityReports,
  works,
  type ChapterOutlineRow,
  type JobChapterRow,
  type JobRow,
} from '@novel/db';
import type { Queue } from 'bullmq';
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { VersionGraphService } from '../versions/version-graph.service';
import { RateLimitService } from '../security/rate-limit.service';
import { chapterGenerationError } from './chapter-generation.errors';

const BATCH_STEPS = ['prepare', 'generate', 'report'] as const;

@Injectable()
export class BatchJobsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: RateLimitService,
    private readonly versions: VersionGraphService,
    @InjectQueue('generation') private readonly generationQueue: Queue,
  ) {}

  async create(userId: string, workId: string, branchId: string, input: CreateBatchJobInput) {
    if (!(await this.rateLimits.consume('generation:batch', userId, 5, 60))) {
      throw chapterGenerationError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '批量生成请求过于频繁，请稍后再试',
      );
    }
    await this.requireBranch(userId, workId, branchId);
    const chapterNumbers = await this.expandScope(workId, branchId, input);
    const now = new Date();
    const created = await this.database.db.transaction(async (tx) => {
      const [job] = await tx
        .insert(jobs)
        .values({
          workId,
          branchId,
          userId,
          type: 'batch_generate',
          status: 'queued',
          payload: {
            scope: input.scope,
            settings: input.settings,
            chapterNumbers,
          },
          progress: 0,
          maxAttempts: 3,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.insert(jobSteps).values(
        BATCH_STEPS.map((stepKey, position) => ({
          jobId: job.id,
          position,
          stepKey,
          status: 'pending' as const,
        })),
      );
      await tx.insert(jobChapters).values(
        chapterNumbers.map((chapterNumber) => ({
          jobId: job.id,
          workId,
          branchId,
          chapterNumber,
          status: 'pending' as const,
          reviewStatus: 'pending' as const,
          createdAt: now,
          updatedAt: now,
        })),
      );
      await tx.insert(jobEvents).values({
        jobId: job.id,
        eventType: 'job.created',
        payload: {
          chapterNumbers,
          scope: input.scope,
          progress: 0,
        },
      });
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
      return job;
    });

    await this.enqueue(created.id, 'initial', userId);
    return this.getJob(userId, workId, branchId, created.id);
  }

  async list(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select()
      .from(jobs)
      .where(
        and(eq(jobs.workId, workId), eq(jobs.branchId, branchId), eq(jobs.type, 'batch_generate')),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(50);

    const items = await Promise.all(
      rows.map(async (job) => {
        const jobItems = await this.listJobChapterRows(job.id);
        return this.toJobSummary(job, jobItems);
      }),
    );
    return { items };
  }

  async getJob(userId: string, workId: string, branchId: string, jobId: string) {
    const job = await this.requireJob(userId, workId, branchId, jobId);
    return this.toJobDetail(job);
  }

  async pause(userId: string, workId: string, branchId: string, jobId: string) {
    const job = await this.requireJob(userId, workId, branchId, jobId);
    await this.transition(job, 'pause');
    return this.getJob(userId, workId, branchId, jobId);
  }

  async resume(userId: string, workId: string, branchId: string, jobId: string) {
    const job = await this.requireJob(userId, workId, branchId, jobId);
    await this.transition(job, 'resume');
    await this.enqueue(job.id, 'resume', userId);
    return this.getJob(userId, workId, branchId, jobId);
  }

  async cancel(userId: string, workId: string, branchId: string, jobId: string) {
    const job = await this.requireJob(userId, workId, branchId, jobId);
    await this.transition(job, 'cancel');
    const now = new Date();
    await this.database.db
      .update(jobChapters)
      .set({ status: 'canceled', updatedAt: now })
      .where(
        and(eq(jobChapters.jobId, job.id), inArray(jobChapters.status, ['pending', 'running'])),
      );
    await this.appendEvent(job.id, 'job.canceled', {});
    await this.refreshReport(job.id);
    return this.getJob(userId, workId, branchId, jobId);
  }

  async retry(userId: string, workId: string, branchId: string, jobId: string) {
    const job = await this.requireJob(userId, workId, branchId, jobId);
    await this.transition(job, 'retry');
    const now = new Date();
    await this.database.db
      .update(jobChapters)
      .set({
        status: 'pending',
        error: null,
        updatedAt: now,
      })
      .where(and(eq(jobChapters.jobId, job.id), eq(jobChapters.status, 'failed')));
    await this.appendEvent(job.id, 'job.retry', {
      message: '从失败步骤继续',
    });
    await this.enqueue(job.id, 'retry', userId);
    return this.getJob(userId, workId, branchId, jobId);
  }

  async listReviewQueue(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select({
        item: jobChapters,
        jobStatus: jobs.status,
      })
      .from(jobChapters)
      .innerJoin(jobs, eq(jobs.id, jobChapters.jobId))
      .where(
        and(
          eq(jobChapters.workId, workId),
          eq(jobChapters.branchId, branchId),
          eq(jobChapters.status, 'waiting_review'),
          eq(jobChapters.reviewStatus, 'pending'),
          eq(jobs.type, 'batch_generate'),
        ),
      )
      .orderBy(asc(jobChapters.createdAt), asc(jobChapters.chapterNumber));

    return {
      items: await Promise.all(
        rows.map(async ({ item, jobStatus }) => this.toReviewItem(item, jobStatus)),
      ),
    };
  }

  async review(
    userId: string,
    workId: string,
    branchId: string,
    jobId: string,
    itemId: string,
    decision: BatchReviewDecision,
  ) {
    const job = await this.requireJob(userId, workId, branchId, jobId);
    const item = await this.requireItem(job, itemId);
    if (item.status !== 'waiting_review' || item.reviewStatus !== 'pending') {
      throw chapterGenerationError(
        HttpStatus.CONFLICT,
        'BATCH_REVIEW_ITEM_NOT_PENDING',
        'This chapter has already been reviewed',
      );
    }

    const now = new Date();
    if (decision.action === 'approve' || decision.action === 'send_to_desk') {
      await this.saveGeneratedVersion(
        job,
        item,
        decision.action === 'approve' ? 'locked' : 'writing',
      );
      await this.database.db
        .update(jobChapters)
        .set({
          status: 'completed',
          reviewStatus: decision.action === 'approve' ? 'approved' : 'sent_to_desk',
          reviewNote: null,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(jobChapters.id, item.id));
    } else if (decision.action === 'ignore') {
      await this.ignoreChapterIssues(job, item, decision.reason);
      await this.saveGeneratedVersion(job, item, 'writing');
      await this.database.db
        .update(jobChapters)
        .set({
          status: 'completed',
          reviewStatus: 'ignored',
          reviewNote: decision.reason,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(jobChapters.id, item.id));
    } else {
      await this.database.db
        .update(jobChapters)
        .set({
          status: 'pending',
          reviewStatus: 'rejected',
          generationJobId: null,
          draftId: null,
          error: null,
          reviewNote: null,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(jobChapters.id, item.id));
      await this.appendEvent(job.id, 'job.review.rejected', {
        chapterNumber: item.chapterNumber,
      });
      await this.database.db
        .update(jobs)
        .set({
          status: 'queued',
          finishedAt: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id));
      await this.enqueue(job.id, 'review-reject', userId);
    }

    await this.appendEvent(job.id, 'job.review.decided', {
      chapterNumber: item.chapterNumber,
      action: decision.action,
    });
    await this.refreshReport(job.id);
    await this.resolveJobAfterReview(job.id);
    const [updated] = await this.database.db
      .select()
      .from(jobChapters)
      .where(eq(jobChapters.id, item.id))
      .limit(1);
    return this.toJobChapterResponse(updated);
  }

  async getReport(userId: string, workId: string, branchId: string, jobId: string) {
    await this.requireJob(userId, workId, branchId, jobId);
    return this.refreshReport(jobId);
  }

  private async expandScope(
    workId: string,
    branchId: string,
    input: CreateBatchJobInput,
  ): Promise<number[]> {
    const outlines = await this.database.db
      .select()
      .from(chapterOutlines)
      .where(and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId)));
    const chapterRows = outlines
      .filter(
        (outline): outline is ChapterOutlineRow & { chapterNumber: number } =>
          outline.level === 'chapter' && outline.chapterNumber !== null,
      )
      .sort((left, right) => left.chapterNumber - right.chapterNumber);

    let chapterNumbers: number[];
    const scope = input.scope;
    if (scope.type === 'chapter') {
      chapterNumbers = chapterRows
        .filter((outline) => outline.chapterNumber === scope.chapterNumber)
        .map((outline) => outline.chapterNumber);
    } else if (scope.type === 'range') {
      chapterNumbers = chapterRows
        .filter(
          (outline) =>
            outline.chapterNumber >= scope.startChapter &&
            outline.chapterNumber <= scope.endChapter,
        )
        .map((outline) => outline.chapterNumber);
      if (chapterNumbers.length !== scope.endChapter - scope.startChapter + 1) {
        throw chapterGenerationError(
          HttpStatus.CONFLICT,
          'BATCH_RANGE_HAS_GAPS',
          'The selected chapter range has gaps. Save the missing chapter outlines first.',
        );
      }
    } else if (scope.type === 'volume') {
      const volume = outlines.find(
        (outline) => outline.id === scope.volumeId && outline.level === 'volume',
      );
      if (!volume) {
        throw chapterGenerationError(HttpStatus.NOT_FOUND, 'VOLUME_NOT_FOUND', 'Volume not found');
      }
      const byId = new Map(outlines.map((outline) => [outline.id, outline]));
      chapterNumbers = chapterRows
        .filter((chapter) => this.isDescendantOf(chapter, volume.id, byId))
        .map((chapter) => chapter.chapterNumber);
    } else {
      chapterNumbers = chapterRows.map((outline) => outline.chapterNumber);
    }

    const unique = [...new Set(chapterNumbers)].sort((left, right) => left - right);
    if (unique.length === 0) {
      throw chapterGenerationError(
        HttpStatus.CONFLICT,
        'BATCH_SCOPE_HAS_NO_CHAPTERS',
        'Save at least one chapter outline before starting a batch task',
      );
    }
    if (unique.length > 1_000) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'BATCH_SCOPE_TOO_LARGE',
        'A batch task can include at most 1000 chapters',
      );
    }
    return unique;
  }

  private isDescendantOf(
    row: ChapterOutlineRow,
    ancestorId: string,
    byId: Map<string, ChapterOutlineRow>,
  ): boolean {
    let parentId = row.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (parentId === ancestorId) {
        return true;
      }
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  }

  private async transition(job: JobRow, event: 'pause' | 'resume' | 'cancel' | 'retry') {
    const transition = transitionJobStatus(job.status, event);
    if (!transition.allowed) {
      throw chapterGenerationError(
        HttpStatus.CONFLICT,
        'BATCH_JOB_INVALID_TRANSITION',
        transition.reason,
      );
    }
    const now = new Date();
    await this.database.db
      .update(jobs)
      .set({
        status: transition.status,
        ...(transition.status === 'canceled' || transition.status === 'failed'
          ? { finishedAt: now }
          : transition.status === 'queued'
            ? { finishedAt: null }
            : {}),
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id));
    await this.appendEvent(job.id, `job.${event}`, {
      from: job.status,
      to: transition.status,
    });
  }

  private async enqueue(jobId: string, reason: string, userId: string) {
    try {
      await this.generationQueue.add(
        'generate-batch',
        { jobId, userId },
        {
          jobId: `batch-${jobId}-${reason}-${Date.now()}`,
          attempts: 1,
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        },
      );
    } catch {
      const failedAt = new Date();
      await this.database.db
        .update(jobs)
        .set({
          status: 'failed',
          error: {
            code: 'BATCH_QUEUE_UNAVAILABLE',
            message: 'The batch queue is temporarily unavailable',
            recoverable: true,
          },
          finishedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(eq(jobs.id, jobId));
      throw chapterGenerationError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'BATCH_QUEUE_UNAVAILABLE',
        'The batch queue is temporarily unavailable',
      );
    }
  }

  private async requireBranch(userId: string, workId: string, branchId: string) {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw chapterGenerationError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    const branch = await this.database.db.query.workBranches.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(whereEq(table.id, branchId), whereEq(table.workId, workId)),
    });
    if (!branch) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Story branch not found',
      );
    }
  }

  private async requireJob(
    userId: string,
    workId: string,
    branchId: string,
    jobId: string,
  ): Promise<JobRow> {
    await this.requireBranch(userId, workId, branchId);
    const [job] = await this.database.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.workId, workId),
          eq(jobs.branchId, branchId),
          eq(jobs.type, 'batch_generate'),
        ),
      )
      .limit(1);
    if (!job) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'BATCH_JOB_NOT_FOUND',
        'Batch task not found',
      );
    }
    return job;
  }

  private async requireItem(job: JobRow, itemId: string): Promise<JobChapterRow> {
    const [item] = await this.database.db
      .select()
      .from(jobChapters)
      .where(and(eq(jobChapters.id, itemId), eq(jobChapters.jobId, job.id)))
      .limit(1);
    if (!item) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'BATCH_REVIEW_ITEM_NOT_FOUND',
        'Review item not found',
      );
    }
    return item;
  }

  private listJobChapterRows(jobId: string) {
    return this.database.db
      .select()
      .from(jobChapters)
      .where(eq(jobChapters.jobId, jobId))
      .orderBy(asc(jobChapters.chapterNumber));
  }

  private async toJobSummary(job: JobRow, items: JobChapterRow[]) {
    const completed = items.filter((item) => item.status === 'completed').length;
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      statusLabel: BATCH_JOB_STATUS_LABELS[job.status],
      progress: job.progress,
      scope: job.payload.scope ?? null,
      chapterNumbers: items.map((item) => item.chapterNumber),
      completedChapterCount: completed,
      failedChapterCount: items.filter((item) => item.status === 'failed').length,
      waitingReviewChapterCount: items.filter((item) => item.status === 'waiting_review').length,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  private async toJobDetail(job: JobRow) {
    const items = await this.listJobChapterRows(job.id);
    const chapterNumbers = items.map((item) => item.chapterNumber);
    const titleRows =
      chapterNumbers.length > 0
        ? await this.database.db
            .select({
              chapterNumber: chapters.chapterNumber,
              title: chapters.title,
            })
            .from(chapters)
            .where(
              and(
                eq(chapters.workId, job.workId),
                eq(chapters.branchId, job.branchId),
                inArray(chapters.chapterNumber, chapterNumbers),
              ),
            )
        : [];
    const titles = new Map(titleRows.map((row) => [row.chapterNumber, row.title]));
    return {
      ...(await this.toJobSummary(job, items)),
      payload: job.payload,
      error: job.error ?? null,
      checkpoint: job.checkpoint ?? null,
      items: items.map((item) => ({
        ...this.toJobChapterResponse(item),
        chapterTitle: titles.get(item.chapterNumber) ?? `第 ${item.chapterNumber} 章`,
      })),
    };
  }

  private toJobChapterResponse(item: JobChapterRow) {
    return {
      id: item.id,
      jobId: item.jobId,
      chapterNumber: item.chapterNumber,
      status: item.status,
      statusLabel: BATCH_CHAPTER_STATUS_LABELS[item.status],
      reviewStatus: item.reviewStatus,
      reviewStatusLabel: BATCH_REVIEW_STATUS_LABELS[item.reviewStatus],
      generationJobId: item.generationJobId,
      draftId: item.draftId,
      promptTokens: item.promptTokens,
      completionTokens: item.completionTokens,
      cost: item.cost,
      error: item.error,
      reviewNote: item.reviewNote,
      reviewedAt: item.reviewedAt?.toISOString() ?? null,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private async toReviewItem(item: JobChapterRow, jobStatus: JobStatus) {
    const [chapter] = await this.database.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, item.workId),
          eq(chapters.branchId, item.branchId),
          eq(chapters.chapterNumber, item.chapterNumber),
        ),
      )
      .limit(1);
    const [draft] = item.draftId
      ? await this.database.db.select().from(drafts).where(eq(drafts.id, item.draftId)).limit(1)
      : [];
    const [quality] = chapter
      ? await this.database.db
          .select()
          .from(qualityReports)
          .where(eq(qualityReports.chapterId, chapter.id))
          .limit(1)
      : [];
    const issueRows = chapter
      ? await this.database.db
          .select()
          .from(annotations)
          .where(
            and(
              eq(annotations.workId, item.workId),
              eq(annotations.branchId, item.branchId),
              eq(annotations.chapterId, chapter.id),
            ),
          )
          .orderBy(asc(annotations.status), asc(annotations.startOffset))
      : [];
    return {
      ...this.toJobChapterResponse(item),
      jobStatus,
      jobStatusLabel: BATCH_JOB_STATUS_LABELS[jobStatus],
      chapterTitle: chapter?.title ?? `第 ${item.chapterNumber} 章`,
      draftPreview: Array.from(draft?.content ?? '')
        .slice(0, 300)
        .join(''),
      quality: quality
        ? {
            summary: quality.report.summary,
            issueCounts: quality.report.issueCounts,
            watchDimensions: quality.report.dimensions
              .filter((dimension) => dimension.status !== 'good')
              .map((dimension) => ({
                label: String(dimension.label ?? ''),
                summary: String(dimension.summary ?? ''),
                suggestion: String(dimension.suggestion ?? ''),
              })),
          }
        : null,
      continuityIssues: issueRows.map((issue) => ({
        id: issue.id,
        severity: issue.severity,
        category: issue.category,
        message: issue.message,
        suggestion: issue.suggestion,
        status: issue.status,
      })),
    };
  }

  private async saveGeneratedVersion(
    job: JobRow,
    item: JobChapterRow,
    status: 'writing' | 'locked',
  ) {
    const [draft] = item.draftId
      ? await this.database.db.select().from(drafts).where(eq(drafts.id, item.draftId)).limit(1)
      : [];
    if (!draft?.content.trim()) {
      throw chapterGenerationError(
        HttpStatus.CONFLICT,
        'BATCH_DRAFT_NOT_READY',
        'The generated chapter text is not ready for review',
      );
    }
    const [chapter] = await this.database.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, item.workId),
          eq(chapters.branchId, item.branchId),
          eq(chapters.chapterNumber, item.chapterNumber),
        ),
      )
      .limit(1);
    if (!chapter) {
      throw chapterGenerationError(
        HttpStatus.CONFLICT,
        'BATCH_CHAPTER_NOT_FOUND',
        'Generated chapter not found',
      );
    }
    const [generation] = item.generationJobId
      ? await this.database.db
          .select()
          .from(generationRequests)
          .where(eq(generationRequests.jobId, item.generationJobId))
          .limit(1)
      : [];

    const created = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chapter.id}))`);
      const [currentMax] = await tx
        .select({ version: max(chapterVersions.version) })
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, chapter.id));
      const [created] = await tx
        .insert(chapterVersions)
        .values({
          chapterId: chapter.id,
          version: Number(currentMax?.version ?? 0) + 1,
          content: draft.content,
          contentHash: createHash('sha256').update(draft.content).digest('hex'),
          wordCount: Array.from(draft.content).filter((character) =>
            /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(character),
          ).length,
          modelConfigId: generation?.modelConfigId ?? null,
          createdBy: job.userId,
          source: 'generated',
          createdAt: new Date(),
        })
        .returning();
      await tx
        .update(chapters)
        .set({
          status,
          currentVersionId: created.id,
          wordCount: created.wordCount,
          autosaveContent: '',
          autosaveUpdatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, chapter.id));
      await tx.update(works).set({ updatedAt: new Date() }).where(eq(works.id, job.workId));
      return created;
    });
    await this.versions.recordChapterVersion(job.userId, job.workId, item.branchId, created.id);
  }

  private async ignoreChapterIssues(job: JobRow, item: JobChapterRow, reason: string) {
    const [chapter] = await this.database.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, item.workId),
          eq(chapters.branchId, item.branchId),
          eq(chapters.chapterNumber, item.chapterNumber),
        ),
      )
      .limit(1);
    if (!chapter) {
      return;
    }
    await this.database.db
      .update(annotations)
      .set({
        status: 'ignored',
        ignoredReason: reason,
        ignoredAt: new Date(),
      })
      .where(
        and(
          eq(annotations.workId, job.workId),
          eq(annotations.branchId, job.branchId),
          eq(annotations.chapterId, chapter.id),
          eq(annotations.status, 'open'),
        ),
      );
  }

  private async refreshReport(jobId: string): Promise<BatchJobReport> {
    const [job] = await this.database.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'BATCH_JOB_NOT_FOUND',
        'Batch task not found',
      );
    }
    const items = await this.listJobChapterRows(job.id);
    const chapterNumbers = items.map((item) => item.chapterNumber);
    const chapterRows =
      chapterNumbers.length > 0
        ? await this.database.db
            .select({
              id: chapters.id,
              chapterNumber: chapters.chapterNumber,
            })
            .from(chapters)
            .where(
              and(
                eq(chapters.workId, job.workId),
                eq(chapters.branchId, job.branchId),
                inArray(chapters.chapterNumber, chapterNumbers),
              ),
            )
        : [];
    const chapterIds = chapterRows.map((chapter) => chapter.id);
    const issueRows =
      chapterIds.length > 0
        ? await this.database.db
            .select()
            .from(annotations)
            .where(
              and(
                eq(annotations.workId, job.workId),
                eq(annotations.branchId, job.branchId),
                inArray(annotations.chapterId, chapterIds),
              ),
            )
        : [];
    const completedChapterNumbers = items
      .filter((item) => item.status === 'completed')
      .map((item) => item.chapterNumber);
    const failedChapters = items
      .filter((item) => item.status === 'failed')
      .map((item) => ({
        chapterNumber: item.chapterNumber,
        message: typeof item.error?.message === 'string' ? item.error.message : '这一章没有完成',
      }));
    const canceledChapterNumbers = items
      .filter((item) => item.status === 'canceled')
      .map((item) => item.chapterNumber);
    const waitingReviewChapterNumbers = items
      .filter((item) => item.status === 'waiting_review')
      .map((item) => item.chapterNumber);
    const promptTokens = items.reduce((total, item) => total + item.promptTokens, 0);
    const completionTokens = items.reduce((total, item) => total + item.completionTokens, 0);
    const cost = Number(items.reduce((total, item) => total + item.cost, 0).toFixed(6));
    const openIssueCount = issueRows.filter((issue) => issue.status === 'open').length;
    const ignoredIssueCount = issueRows.filter((issue) => issue.status === 'ignored').length;
    const chaptersWithIssues = new Set(issueRows.map((issue) => issue.chapterId)).size;
    const summary =
      issueRows.length === 0
        ? '连续性检查没有发现需要处理的问题。'
        : `共发现 ${issueRows.length} 个连续性问题，其中 ${openIssueCount} 个待处理，${ignoredIssueCount} 个已忽略。`;
    const report: BatchJobReport = {
      jobId: job.id,
      generatedAt: new Date().toISOString(),
      totalChapters: items.length,
      completedChapterNumbers,
      failedChapters,
      canceledChapterNumbers,
      waitingReviewChapterNumbers,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost,
      continuity: {
        issueCount: issueRows.length,
        openIssueCount,
        ignoredIssueCount,
        chaptersWithIssues,
        summary,
      },
    };
    const now = new Date();
    await this.database.db
      .insert(jobReports)
      .values({
        jobId: job.id,
        report: report as unknown as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: jobReports.jobId,
        set: {
          report: report as unknown as Record<string, unknown>,
          updatedAt: now,
        },
      });
    return report;
  }

  private async resolveJobAfterReview(jobId: string) {
    const [job] = await this.database.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job || job.status === 'canceled') {
      return;
    }
    const items = await this.listJobChapterRows(jobId);
    if (items.some((item) => item.status === 'pending' || item.status === 'running')) {
      return;
    }
    const status: JobStatus = items.some((item) => item.status === 'waiting_review')
      ? 'waiting_review'
      : items.some((item) => item.status === 'failed')
        ? 'failed'
        : 'completed';
    if (job.status === status) {
      return;
    }
    const now = new Date();
    await this.database.db
      .update(jobs)
      .set({
        status,
        progress: status === 'completed' ? 100 : job.progress,
        finishedAt: status === 'completed' || status === 'failed' ? now : null,
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId));
    await this.appendEvent(jobId, `job.${status}`, {
      progress: status === 'completed' ? 100 : job.progress,
    });
  }

  private async appendEvent(jobId: string, eventType: string, payload: Record<string, unknown>) {
    await this.database.db.insert(jobEvents).values({
      jobId,
      eventType,
      payload,
    });
  }
}
