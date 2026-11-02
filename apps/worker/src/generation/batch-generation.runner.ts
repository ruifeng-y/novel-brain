import { Injectable } from '@nestjs/common';
import { DEFAULT_CHAPTER_TARGET_MAX, DEFAULT_CHAPTER_TARGET_MIN } from '@novel/contracts';
import { estimateModelCost } from '@novel/core';
import {
  annotations,
  chapterOutlines,
  chapters,
  drafts,
  generationRequests,
  jobChapters,
  jobEvents,
  jobReports,
  jobSteps,
  jobs,
  type JobChapterRow,
  type JobRow,
} from '@novel/db';
import { and, asc, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { ChapterGenerationRunner } from './chapter-generation.runner';

const GENERATION_STEPS = [
  'readiness',
  'brief',
  'context',
  'draft',
  'extract_facts',
  'verify',
] as const;

@Injectable()
export class BatchGenerationRunner {
  constructor(
    private readonly database: DatabaseService,
    private readonly chapterRunner: ChapterGenerationRunner,
  ) {}

  async run(batchJobId: string): Promise<{ ok: boolean }> {
    const job = await this.requireJob(batchJobId);
    if (['paused', 'canceled', 'completed', 'failed'].includes(job.status)) {
      return { ok: job.status === 'completed' };
    }

    const startedAt = new Date();
    await this.database.db
      .update(jobs)
      .set({
        status: 'preparing',
        startedAt: job.startedAt ?? startedAt,
        updatedAt: startedAt,
      })
      .where(eq(jobs.id, job.id));
    await this.appendEvent(job.id, 'job.preparing', {
      progress: 2,
      scope: job.payload.scope ?? null,
    });
    await this.completeBatchStep(job.id, 'prepare', {
      chapterNumbers: job.payload.chapterNumbers ?? [],
    });

    if (
      !(await this.beginBatchStep(job.id, 'generate', {
        chapterNumbers: job.payload.chapterNumbers ?? [],
      }))
    ) {
      await this.writeReport(job.id);
      return { ok: false };
    }
    try {
      let items = await this.listItems(job.id);
      for (const item of items) {
        const latestJob = await this.requireJob(job.id);
        if (latestJob.status === 'paused' || latestJob.status === 'canceled') {
          await this.writeReport(job.id);
          return { ok: false };
        }
        if (item.status !== 'pending') {
          continue;
        }
        await this.generateChapter(latestJob, item);
        items = await this.listItems(job.id);
        if (!(await this.updateProgress(job.id, items))) {
          await this.writeReport(job.id);
          return { ok: false };
        }
      }

      const latestJob = await this.requireJob(job.id);
      if (latestJob.status === 'paused' || latestJob.status === 'canceled') {
        await this.writeReport(job.id);
        return { ok: false };
      }

      await this.completeBatchStep(job.id, 'generate', {
        total: items.length,
        completed: items.filter((item) => item.status === 'completed').length,
        waitingReview: items.filter((item) => item.status === 'waiting_review').length,
        failed: items.filter((item) => item.status === 'failed').length,
      });
      if (!(await this.beginBatchStep(job.id, 'report', {}))) {
        await this.writeReport(job.id);
        return { ok: false };
      }
      const report = await this.writeReport(job.id);
      await this.completeBatchStep(job.id, 'report', {
        totalChapters: report.totalChapters,
        totalTokens: report.totalTokens,
      });

      const finalStatus = items.some((item) => item.status === 'waiting_review')
        ? 'waiting_review'
        : items.some((item) => item.status === 'failed')
          ? 'failed'
          : 'completed';
      const finishedAt = new Date();
      const [finishedJob] = await this.database.db
        .update(jobs)
        .set({
          status: finalStatus,
          progress: 100,
          checkpoint: { stepKey: 'report' },
          finishedAt: finalStatus === 'completed' || finalStatus === 'failed' ? finishedAt : null,
          updatedAt: finishedAt,
        })
        .where(and(eq(jobs.id, job.id), inArray(jobs.status, ['preparing', 'running'])))
        .returning({ id: jobs.id });
      if (!finishedJob) {
        await this.writeReport(job.id);
        return { ok: false };
      }
      await this.appendEvent(job.id, `job.${finalStatus}`, {
        progress: 100,
        report,
      });
      return { ok: finalStatus !== 'failed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The batch task could not finish';
      const failedAt = new Date();
      const [failedJob] = await this.database.db
        .update(jobs)
        .set({
          status: 'failed',
          error: {
            code: 'BATCH_GENERATION_FAILED',
            message,
            recoverable: true,
          },
          finishedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(and(eq(jobs.id, job.id), inArray(jobs.status, ['preparing', 'running'])))
        .returning({ id: jobs.id });
      if (!failedJob) {
        await this.writeReport(job.id);
        return { ok: false };
      }
      await this.appendEvent(job.id, 'job.failed', {
        code: 'BATCH_GENERATION_FAILED',
        message,
        recoverable: true,
      });
      await this.writeReport(job.id);
      return { ok: false };
    }
  }

  private async generateChapter(job: JobRow, item: JobChapterRow) {
    const now = new Date();
    const [claimed] = await this.database.db
      .update(jobChapters)
      .set({
        status: 'running',
        updatedAt: now,
      })
      .where(and(eq(jobChapters.id, item.id), eq(jobChapters.status, 'pending')))
      .returning({ id: jobChapters.id });
    if (!claimed) {
      return;
    }
    await this.appendEvent(job.id, 'job.chapter.started', {
      chapterNumber: item.chapterNumber,
    });

    try {
      const generation = await this.ensureGenerationJob(job, item);
      const result = await this.chapterRunner.run(generation.jobId, {
        retry: generation.retry,
      });
      const [generationJob] = await this.database.db
        .select()
        .from(jobs)
        .where(eq(jobs.id, generation.jobId))
        .limit(1);
      const [draft] = await this.database.db
        .select()
        .from(drafts)
        .where(eq(drafts.generationRequestId, generation.requestId))
        .limit(1);
      const promptTokens = item.promptTokens + (result.promptTokens ?? 0);
      const completionTokens = item.completionTokens + (result.completionTokens ?? 0);
      const cost = estimateModelCost(promptTokens, completionTokens);
      const completed = generationJob?.status === 'completed';
      const [updatedItem] = await this.database.db
        .update(jobChapters)
        .set({
          status: completed ? 'waiting_review' : 'failed',
          reviewStatus: completed ? 'pending' : 'pending',
          generationJobId: generation.jobId,
          draftId: draft?.id ?? null,
          promptTokens,
          completionTokens,
          cost,
          error: completed
            ? null
            : ((generationJob?.error as Record<string, unknown> | null) ??
              result.error ?? {
                code: 'BATCH_CHAPTER_FAILED',
                message: '这一章没有完成',
              }),
          updatedAt: new Date(),
        })
        .where(and(eq(jobChapters.id, item.id), eq(jobChapters.status, 'running')))
        .returning({ id: jobChapters.id });
      if (!updatedItem) {
        await this.appendEvent(job.id, 'job.chapter.discarded', {
          chapterNumber: item.chapterNumber,
          reason: 'paused_or_canceled',
          draftId: draft?.id ?? null,
        });
        return;
      }
      await this.appendEvent(job.id, 'job.chapter.finished', {
        chapterNumber: item.chapterNumber,
        status: completed ? 'waiting_review' : 'failed',
        promptTokens,
        completionTokens,
        cost,
        ...(result.continuityIssueCount === undefined
          ? {}
          : { continuityIssueCount: result.continuityIssueCount }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '这一章没有完成';
      const [failedItem] = await this.database.db
        .update(jobChapters)
        .set({
          status: 'failed',
          error: {
            code: 'BATCH_CHAPTER_FAILED',
            message,
          },
          updatedAt: new Date(),
        })
        .where(and(eq(jobChapters.id, item.id), eq(jobChapters.status, 'running')))
        .returning({ id: jobChapters.id });
      if (!failedItem) {
        await this.appendEvent(job.id, 'job.chapter.discarded', {
          chapterNumber: item.chapterNumber,
          reason: 'paused_or_canceled',
        });
        return;
      }
      await this.appendEvent(job.id, 'job.chapter.finished', {
        chapterNumber: item.chapterNumber,
        status: 'failed',
        message,
      });
    }
  }

  private async ensureGenerationJob(job: JobRow, item: JobChapterRow) {
    if (item.generationJobId) {
      const [generation] = await this.database.db
        .select()
        .from(generationRequests)
        .where(eq(generationRequests.jobId, item.generationJobId))
        .limit(1);
      if (generation) {
        const [child] = await this.database.db
          .select()
          .from(jobs)
          .where(eq(jobs.id, item.generationJobId))
          .limit(1);
        return {
          jobId: item.generationJobId,
          requestId: generation.id,
          retry: child?.status === 'failed',
        };
      }
    }

    const [outline] = await this.database.db
      .select()
      .from(chapterOutlines)
      .where(
        and(
          eq(chapterOutlines.workId, job.workId),
          eq(chapterOutlines.branchId, job.branchId),
          eq(chapterOutlines.chapterNumber, item.chapterNumber),
          eq(chapterOutlines.level, 'chapter'),
        ),
      )
      .limit(1);
    if (!outline) {
      throw new Error(`第 ${item.chapterNumber} 章还没有章纲`);
    }
    const [chapter] = await this.database.db
      .insert(chapters)
      .values({
        workId: job.workId,
        branchId: job.branchId,
        chapterNumber: item.chapterNumber,
        title: outline.title.trim() || `第 ${item.chapterNumber} 章`,
        status: 'writing',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [chapters.workId, chapters.branchId, chapters.chapterNumber],
        set: { updatedAt: new Date() },
      })
      .returning();

    const rawSettings = this.record(job.payload.settings);
    const settings: Record<string, unknown> = {
      ...rawSettings,
      referenceChapters: await this.referenceChaptersFor(
        job,
        item.chapterNumber,
        rawSettings.referenceChapters,
      ),
    };
    const created = await this.database.db.transaction(async (tx) => {
      const now = new Date();
      const [generation] = await tx
        .insert(generationRequests)
        .values({
          workId: job.workId,
          branchId: job.branchId,
          chapterId: chapter.id,
          type: 'chapter',
          modelConfigId: typeof settings.modelConfigId === 'string' ? settings.modelConfigId : null,
          status: 'queued',
          createdBy: job.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const [generationJob] = await tx
        .insert(jobs)
        .values({
          workId: job.workId,
          branchId: job.branchId,
          userId: job.userId,
          type: 'generate_chapter',
          status: 'queued',
          payload: {
            generationRequestId: generation.id,
            chapterId: chapter.id,
            chapterNumber: item.chapterNumber,
            outlineId: outline.id,
            action: 'chapter',
            outputKind: 'chapter',
            targetMinCharacters: this.number(
              settings.targetMinCharacters,
              DEFAULT_CHAPTER_TARGET_MIN,
            ),
            targetMaxCharacters: this.number(
              settings.targetMaxCharacters,
              DEFAULT_CHAPTER_TARGET_MAX,
            ),
            settings,
          },
          progress: 0,
          maxAttempts: 2,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx
        .update(generationRequests)
        .set({ jobId: generationJob.id, updatedAt: now })
        .where(eq(generationRequests.id, generation.id));
      await tx.insert(jobSteps).values(
        GENERATION_STEPS.map((stepKey, position) => ({
          jobId: generationJob.id,
          position,
          stepKey,
          status: 'pending' as const,
        })),
      );
      await tx.insert(jobEvents).values({
        jobId: generationJob.id,
        eventType: 'job.created',
        payload: {
          batchJobId: job.id,
          chapterNumber: item.chapterNumber,
        },
      });
      return { generation, job: generationJob };
    });
    return {
      jobId: created.job.id,
      requestId: created.generation.id,
      retry: false,
    };
  }

  private async updateProgress(jobId: string, items: JobChapterRow[]): Promise<boolean> {
    const finished = items.filter((item) =>
      ['waiting_review', 'completed', 'failed', 'canceled'].includes(item.status),
    ).length;
    const progress = Math.min(95, Math.round((finished / items.length) * 95));
    const [updated] = await this.database.db
      .update(jobs)
      .set({ status: 'running', progress, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['preparing', 'running'])))
      .returning({ id: jobs.id });
    if (!updated) {
      await this.appendEvent(jobId, 'job.progress.skipped', {
        progress,
        reason: 'job_not_active',
      });
      return false;
    }
    await this.appendEvent(jobId, 'job.progress', {
      progress,
      finished,
      total: items.length,
    });
    return true;
  }

  private async referenceChaptersFor(
    job: JobRow,
    chapterNumber: number,
    configuredValue: unknown,
  ): Promise<number[]> {
    const configured = Array.isArray(configuredValue)
      ? configuredValue.filter(
          (value): value is number =>
            typeof value === 'number' &&
            Number.isInteger(value) &&
            value > 0 &&
            value < chapterNumber,
        )
      : [];
    const previous = await this.database.db
      .select({ chapterNumber: chapters.chapterNumber })
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, job.workId),
          eq(chapters.branchId, job.branchId),
          lt(chapters.chapterNumber, chapterNumber),
          isNotNull(chapters.currentVersionId),
          inArray(chapters.status, ['locked', 'published']),
        ),
      )
      .orderBy(desc(chapters.chapterNumber))
      .limit(3);
    return [
      ...new Set([...configured, ...previous.map((chapter) => chapter.chapterNumber).reverse()]),
    ].slice(0, 20);
  }

  private async writeReport(jobId: string) {
    const job = await this.requireJob(jobId);
    const items = await this.listItems(job.id);
    const chapterNumbers = items.map((item) => item.chapterNumber);
    const chapterRows = await this.database.db
      .select({ id: chapters.id, chapterNumber: chapters.chapterNumber })
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, job.workId),
          eq(chapters.branchId, job.branchId),
          chapterNumbers.length > 0
            ? inArray(chapters.chapterNumber, chapterNumbers)
            : eq(chapters.id, '00000000-0000-0000-0000-000000000000'),
        ),
      );
    const issueRows =
      chapterRows.length > 0
        ? await this.database.db
            .select()
            .from(annotations)
            .where(
              and(
                eq(annotations.workId, job.workId),
                eq(annotations.branchId, job.branchId),
                inArray(
                  annotations.chapterId,
                  chapterRows.map((chapter) => chapter.id),
                ),
              ),
            )
        : [];
    const promptTokens = items.reduce((total, item) => total + item.promptTokens, 0);
    const completionTokens = items.reduce((total, item) => total + item.completionTokens, 0);
    const openIssueCount = issueRows.filter((issue) => issue.status === 'open').length;
    const ignoredIssueCount = issueRows.filter((issue) => issue.status === 'ignored').length;
    const report = {
      jobId: job.id,
      generatedAt: new Date().toISOString(),
      totalChapters: items.length,
      completedChapterNumbers: items
        .filter((item) => item.status === 'completed')
        .map((item) => item.chapterNumber),
      failedChapters: items
        .filter((item) => item.status === 'failed')
        .map((item) => ({
          chapterNumber: item.chapterNumber,
          message: typeof item.error?.message === 'string' ? item.error.message : '这一章没有完成',
        })),
      canceledChapterNumbers: items
        .filter((item) => item.status === 'canceled')
        .map((item) => item.chapterNumber),
      waitingReviewChapterNumbers: items
        .filter((item) => item.status === 'waiting_review')
        .map((item) => item.chapterNumber),
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost: Number(items.reduce((total, item) => total + item.cost, 0).toFixed(6)),
      continuity: {
        issueCount: issueRows.length,
        openIssueCount,
        ignoredIssueCount,
        chaptersWithIssues: new Set(issueRows.map((issue) => issue.chapterId)).size,
        summary:
          issueRows.length === 0
            ? '连续性检查没有发现需要处理的问题。'
            : `共发现 ${issueRows.length} 个连续性问题，其中 ${openIssueCount} 个待处理，${ignoredIssueCount} 个已忽略。`,
      },
    };
    const now = new Date();
    await this.database.db
      .insert(jobReports)
      .values({
        jobId: job.id,
        report,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: jobReports.jobId,
        set: { report, updatedAt: now },
      });
    return report;
  }

  private listItems(jobId: string) {
    return this.database.db
      .select()
      .from(jobChapters)
      .where(eq(jobChapters.jobId, jobId))
      .orderBy(asc(jobChapters.chapterNumber));
  }

  private async requireJob(jobId: string): Promise<JobRow> {
    const [job] = await this.database.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      throw new Error(`Batch job ${jobId} was not found`);
    }
    return job;
  }

  private async beginBatchStep(
    jobId: string,
    stepKey: 'generate' | 'report',
    input: Record<string, unknown>,
  ): Promise<boolean> {
    const now = new Date();
    const [activeJob] = await this.database.db
      .update(jobs)
      .set({ status: 'running', updatedAt: now })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['preparing', 'running'])))
      .returning({ id: jobs.id });
    if (!activeJob) {
      await this.appendEvent(jobId, 'job.step.skipped', {
        stepKey,
        reason: 'job_not_active',
      });
      return false;
    }
    await this.database.db
      .update(jobSteps)
      .set({ status: 'running', input, startedAt: now })
      .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stepKey, stepKey)));
    await this.appendEvent(jobId, 'job.step.started', { stepKey });
    return true;
  }

  private async completeBatchStep(
    jobId: string,
    stepKey: 'prepare' | 'generate' | 'report',
    output: Record<string, unknown>,
  ) {
    const now = new Date();
    await this.database.db
      .update(jobSteps)
      .set({ status: 'succeeded', output, finishedAt: now })
      .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stepKey, stepKey)));
    await this.database.db
      .update(jobs)
      .set({ checkpoint: { stepKey }, updatedAt: now })
      .where(eq(jobs.id, jobId));
    await this.appendEvent(jobId, 'job.step.succeeded', { stepKey });
  }

  private async appendEvent(jobId: string, eventType: string, payload: Record<string, unknown>) {
    await this.database.db.insert(jobEvents).values({
      jobId,
      eventType,
      payload,
    });
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private number(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
  }
}
