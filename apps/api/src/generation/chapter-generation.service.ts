import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CHAPTER_ACTION_OUTPUT_KIND,
  CONTINUITY_CATEGORY_LABELS,
  CONTINUITY_ISSUE_CATEGORIES,
  CONTINUITY_SEVERITY_LABELS,
  CONTINUITY_STATUS_LABELS,
  CHAPTER_STATUS_LABELS,
  FACT_TYPE_LABELS,
  QUALITY_TIER_LABELS,
  countCjkCharacters,
  type ChapterGenerationAction,
  type ChapterQualityReport,
  type ChapterStatus,
  type ConfirmFactProposalInput,
  type GenerateChapterInput,
  type IgnoreContinuityIssueInput,
  type SaveChapterAutosaveInput,
  type SaveChapterVersionInput,
  type UpdateChapterMetadataInput,
} from '@novel/contracts';
import {
  annotations,
  canonCommits,
  canonSnapshots,
  characterStates,
  chapterOutlines,
  chapterVersions,
  chapters,
  contextPacks,
  drafts,
  factProposals,
  facts,
  foreshadows,
  generationRequests,
  jobEvents,
  jobSteps,
  jobs,
  modelConfigs,
  entities,
  qualityReports,
  workBranches,
  works,
  type ChapterOutlineRow,
  type ChapterRow,
  type ChapterVersionRow,
  type FactProposalRow,
  type JobRow,
  type QualityReportRow,
} from '@novel/db';
import type { Queue } from 'bullmq';
import { and, asc, desc, eq, gt, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { BranchStateService } from '../branches/branch-state.service';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../security/rate-limit.service';
import { chapterGenerationError } from './chapter-generation.errors';

const GENERATION_STEPS = [
  'readiness',
  'brief',
  'context',
  'draft',
  'extract_facts',
  'verify',
] as const;

type ChapterListItem = {
  chapterNumber: number;
  title: string;
  goal: string;
  status: ChapterStatus;
  statusLabel: string;
  wordCount: number;
  hasContent: boolean;
};

type ChapterOutlineResponse = {
  id: string;
  workId: string;
  branchId: string;
  chapterNumber: number;
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
  createdAt: string;
  updatedAt: string;
};

export type JobEventMessage = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

@Injectable()
export class ChapterGenerationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: RateLimitService,
    private readonly branchState: BranchStateService,
    @InjectQueue('generation') private readonly generationQueue: Queue,
  ) {}

  async listChapters(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<{ items: ChapterListItem[] }> {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select({
        outline: chapterOutlines,
        chapter: chapters,
      })
      .from(chapterOutlines)
      .leftJoin(
        chapters,
        and(
          eq(chapters.workId, chapterOutlines.workId),
          eq(chapters.branchId, chapterOutlines.branchId),
          eq(chapters.chapterNumber, chapterOutlines.chapterNumber),
        ),
      )
      .where(
        and(
          eq(chapterOutlines.workId, workId),
          eq(chapterOutlines.branchId, branchId),
          eq(chapterOutlines.level, 'chapter'),
          isNotNull(chapterOutlines.chapterNumber),
        ),
      )
      .orderBy(chapterOutlines.chapterNumber);

    return {
      items: rows.map(({ outline, chapter }) => ({
        chapterNumber: outline.chapterNumber ?? 0,
        title:
          chapter?.title ??
          (outline.title.trim() || this.defaultChapterTitle(outline.chapterNumber ?? 0)),
        goal: outline.chapterGoal,
        status: chapter?.status ?? 'planned',
        statusLabel: CHAPTER_STATUS_LABELS[chapter?.status ?? 'planned'],
        wordCount: chapter?.wordCount ?? 0,
        hasContent: Boolean(chapter?.currentVersionId),
      })),
    };
  }

  async getChapter(userId: string, workId: string, branchId: string, chapterNumber: number) {
    await this.requireBranch(userId, workId, branchId);
    const outline = await this.requireOutline(workId, branchId, chapterNumber);
    const [chapter] = await this.database.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
          eq(chapters.chapterNumber, chapterNumber),
        ),
      )
      .limit(1);

    const [versionRows, latestGeneration] = await Promise.all([
      chapter
        ? this.database.db
            .select()
            .from(chapterVersions)
            .where(eq(chapterVersions.chapterId, chapter.id))
            .orderBy(desc(chapterVersions.version))
        : Promise.resolve([] as ChapterVersionRow[]),
      chapter
        ? this.database.db
            .select()
            .from(generationRequests)
            .where(eq(generationRequests.chapterId, chapter.id))
            .orderBy(desc(generationRequests.createdAt))
            .limit(1)
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
    ]);

    const currentVersion = chapter?.currentVersionId
      ? (versionRows.find((version) => version.id === chapter.currentVersionId) ?? null)
      : null;
    const latestDraft = latestGeneration
      ? (
          await this.database.db
            .select()
            .from(drafts)
            .where(eq(drafts.generationRequestId, latestGeneration.id))
            .limit(1)
        )[0]
      : undefined;
    const latestContext = latestGeneration
      ? (
          await this.database.db
            .select()
            .from(contextPacks)
            .where(eq(contextPacks.generationRequestId, latestGeneration.id))
            .limit(1)
        )[0]
      : undefined;
    const latestJob =
      latestGeneration?.jobId !== undefined && latestGeneration?.jobId !== null
        ? (
            await this.database.db
              .select()
              .from(jobs)
              .where(eq(jobs.id, latestGeneration.jobId))
              .limit(1)
          )[0]
        : undefined;

    return {
      chapterNumber,
      title: chapter?.title ?? (outline.title.trim() || this.defaultChapterTitle(chapterNumber)),
      status: chapter?.status ?? 'planned',
      statusLabel: CHAPTER_STATUS_LABELS[chapter?.status ?? 'planned'],
      wordCount: chapter?.wordCount ?? 0,
      summary: chapter?.summary ?? '',
      hook: chapter?.hook ?? '',
      content: currentVersion?.content ?? '',
      outline: this.toOutlineResponse(outline),
      currentVersion: currentVersion ? this.toVersionResponse(chapterNumber, currentVersion) : null,
      latestDraft: latestDraft
        ? {
            id: latestDraft.id,
            jobId: latestGeneration?.jobId ?? null,
            status: latestDraft.status,
            content: latestDraft.content,
            error: latestJob?.error ?? null,
            updatedAt: latestDraft.updatedAt.toISOString(),
          }
        : null,
      autosave:
        chapter?.autosaveUpdatedAt && chapter.autosaveContent
          ? {
              content: chapter.autosaveContent,
              wordCount: countCjkCharacters(chapter.autosaveContent),
              updatedAt: chapter.autosaveUpdatedAt.toISOString(),
            }
          : null,
      versions: versionRows.map((version) => this.toVersionResponse(chapterNumber, version)),
      context: latestContext
        ? {
            id: latestContext.id,
            tokenBudget: latestContext.tokenBudget,
            sections: latestContext.sections,
            sourceRefs: latestContext.sourceRefs,
            createdAt: latestContext.createdAt.toISOString(),
          }
        : null,
      latestGeneration: latestGeneration
        ? {
            id: latestGeneration.id,
            jobId: latestGeneration.jobId,
            status: latestGeneration.status,
          }
        : null,
    };
  }

  async startGeneration(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    input: GenerateChapterInput,
  ) {
    return this.startGenerationAction(userId, workId, branchId, chapterNumber, 'chapter', input);
  }

  async startGenerationAction(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    action: ChapterGenerationAction,
    input: GenerateChapterInput,
  ) {
    if (!(await this.rateLimits.consume('generation:chapter', userId, 10, 60))) {
      throw chapterGenerationError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '生成请求过于频繁，请稍后再试',
      );
    }
    await this.requireBranch(userId, workId, branchId);
    const outline = await this.requireOutline(workId, branchId, chapterNumber);
    this.requireActionInput(action, input);
    const modelConfig = await this.selectProseModelConfig(userId, input.modelConfigId);
    if (!modelConfig) {
      throw chapterGenerationError(
        HttpStatus.CONFLICT,
        'MODEL_CONFIG_REQUIRED',
        'Configure a prose model before generating',
      );
    }

    const outputKind = CHAPTER_ACTION_OUTPUT_KIND[action];
    const writingSettings = {
      qualityTier: input.qualityTier,
      qualityTierLabel: QUALITY_TIER_LABELS[input.qualityTier],
      modelConfigId: modelConfig.id,
      targetMinCharacters: input.targetMinCharacters,
      targetMaxCharacters: input.targetMaxCharacters,
      pov: input.pov ?? null,
      targetPov: input.targetPov ?? null,
      mustInclude: input.mustInclude,
      mustAvoid: input.mustAvoid,
      referenceChapters: input.referenceChapters,
      tabooWords: input.tabooWords,
      cursorOffset: input.cursorOffset ?? null,
      selectionStart: input.selectionStart ?? null,
      selectionEnd: input.selectionEnd ?? null,
    };
    const chapter = await this.ensureChapter(workId, branchId, chapterNumber, outline.title);
    const created = await this.database.db.transaction(async (tx) => {
      const now = new Date();
      const [generation] = await tx
        .insert(generationRequests)
        .values({
          workId,
          branchId,
          chapterId: chapter.id,
          type: action,
          instruction: input.instruction || null,
          modelConfigId: modelConfig.id,
          status: 'queued',
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const [job] = await tx
        .insert(jobs)
        .values({
          workId,
          branchId,
          userId,
          type: 'generate_chapter',
          status: 'queued',
          payload: {
            generationRequestId: generation.id,
            chapterId: chapter.id,
            chapterNumber,
            outlineId: outline.id,
            action,
            outputKind,
            targetMinCharacters: input.targetMinCharacters,
            targetMaxCharacters: input.targetMaxCharacters,
            settings: writingSettings,
            content: input.content ?? null,
            selection: input.selection ?? null,
            selectionStart: input.selectionStart ?? null,
            selectionEnd: input.selectionEnd ?? null,
            targetPov: input.targetPov ?? null,
          },
          progress: 0,
          maxAttempts: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx
        .update(generationRequests)
        .set({ jobId: job.id, updatedAt: now })
        .where(eq(generationRequests.id, generation.id));
      await tx.insert(jobSteps).values(
        GENERATION_STEPS.map((stepKey, position) => ({
          jobId: job.id,
          position,
          stepKey,
          status: 'pending' as const,
        })),
      );
      await tx.insert(jobEvents).values({
        jobId: job.id,
        eventType: 'job.created',
        payload: {
          chapterNumber,
          generationRequestId: generation.id,
          progress: 0,
        },
      });
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));

      return { generation, job };
    });

    try {
      await this.generationQueue.add(
        'generate-chapter',
        { jobId: created.job.id, userId },
        {
          jobId: created.job.id,
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
            code: 'GENERATION_QUEUE_UNAVAILABLE',
            message: 'The writing queue is temporarily unavailable',
            recoverable: true,
          },
          finishedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(eq(jobs.id, created.job.id));
      await this.database.db
        .update(generationRequests)
        .set({ status: 'failed', finishedAt: failedAt, updatedAt: failedAt })
        .where(eq(generationRequests.id, created.generation.id));
      await this.database.db.insert(jobEvents).values({
        jobId: created.job.id,
        eventType: 'job.failed',
        payload: {
          code: 'GENERATION_QUEUE_UNAVAILABLE',
          message: 'The writing queue is temporarily unavailable',
          recoverable: true,
        },
      });
    }

    return {
      generationRequestId: created.generation.id,
      jobId: created.job.id,
      chapterNumber,
      action,
      outputKind,
      status: 'queued',
    };
  }

  async getJob(userId: string, workId: string, branchId: string, jobId: string) {
    const job = await this.requireJob(userId, workId, branchId, jobId);
    const [generation] = await this.database.db
      .select()
      .from(generationRequests)
      .where(eq(generationRequests.jobId, job.id))
      .limit(1);
    const [context] = generation
      ? await this.database.db
          .select()
          .from(contextPacks)
          .where(eq(contextPacks.generationRequestId, generation.id))
          .limit(1)
      : [];
    const [draft] = generation
      ? await this.database.db
          .select()
          .from(drafts)
          .where(eq(drafts.generationRequestId, generation.id))
          .limit(1)
      : [];
    const steps = await this.database.db
      .select()
      .from(jobSteps)
      .where(eq(jobSteps.jobId, job.id))
      .orderBy(asc(jobSteps.position));

    return {
      id: job.id,
      generationRequestId: generation?.id ?? null,
      chapterNumber: Number(job.payload.chapterNumber ?? 0),
      action: job.payload.action ?? generation?.type ?? 'chapter',
      outputKind:
        job.payload.outputKind ??
        CHAPTER_ACTION_OUTPUT_KIND[
          (job.payload.action as ChapterGenerationAction | undefined) ?? 'chapter'
        ],
      targetMinCharacters: Number(job.payload.targetMinCharacters ?? 0),
      targetMaxCharacters: Number(job.payload.targetMaxCharacters ?? 0),
      settings: job.payload.settings ?? {},
      status: job.status,
      progress: job.progress,
      modelConfigId: generation?.modelConfigId ?? null,
      error: job.error ?? null,
      checkpoint: job.checkpoint ?? null,
      steps: steps.map((step) => ({
        key: step.stepKey,
        status: step.status,
        input: step.input,
        output: step.output,
        error: step.error,
        startedAt: step.startedAt?.toISOString() ?? null,
        finishedAt: step.finishedAt?.toISOString() ?? null,
      })),
      context: context
        ? {
            id: context.id,
            tokenBudget: context.tokenBudget,
            sections: context.sections,
            sourceRefs: context.sourceRefs,
            createdAt: context.createdAt.toISOString(),
          }
        : null,
      draft: draft
        ? {
            id: draft.id,
            status: draft.status,
            content: draft.content,
            updatedAt: draft.updatedAt.toISOString(),
          }
        : null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  async streamJobEvents(
    userId: string,
    workId: string,
    branchId: string,
    jobId: string,
    afterSequence: number,
  ): Promise<Observable<JobEventMessage>> {
    await this.requireJob(userId, workId, branchId, jobId);

    return new Observable<JobEventMessage>((subscriber) => {
      let cursor = Number.isFinite(afterSequence) ? afterSequence : 0;
      let polling = false;
      let closed = false;

      const poll = async () => {
        if (polling || closed) {
          return;
        }
        polling = true;
        try {
          const events = await this.database.db
            .select()
            .from(jobEvents)
            .where(and(eq(jobEvents.jobId, jobId), gt(jobEvents.sequence, cursor)))
            .orderBy(asc(jobEvents.sequence));
          for (const event of events) {
            if (closed) {
              return;
            }
            cursor = event.sequence;
            subscriber.next({
              id: String(event.sequence),
              type: event.eventType,
              data: event.payload,
            });
          }

          const [job] = await this.database.db
            .select({ status: jobs.status })
            .from(jobs)
            .where(eq(jobs.id, jobId))
            .limit(1);
          if (
            job &&
            ['completed', 'failed', 'canceled'].includes(job.status) &&
            events.length === 0
          ) {
            subscriber.complete();
          }
        } catch (error) {
          subscriber.error(error);
        } finally {
          polling = false;
        }
      };

      const timer = setInterval(() => void poll(), 100);
      void poll();

      return () => {
        closed = true;
        clearInterval(timer);
      };
    });
  }

  async assertJobAccess(
    userId: string,
    workId: string,
    branchId: string,
    jobId: string,
  ): Promise<void> {
    await this.requireJob(userId, workId, branchId, jobId);
  }

  async saveVersion(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    input: SaveChapterVersionInput,
  ) {
    await this.requireBranch(userId, workId, branchId);
    const outline = await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.ensureChapter(workId, branchId, chapterNumber, outline.title);
    const contentHash = createHash('sha256').update(input.content).digest('hex');
    const wordCount = countCjkCharacters(input.content);

    const saved = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chapter.id}))`);
      const [currentMax] = await tx
        .select({ version: max(chapterVersions.version) })
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, chapter.id));
      const version = Number(currentMax?.version ?? 0) + 1;
      const now = new Date();
      const [created] = await tx
        .insert(chapterVersions)
        .values({
          chapterId: chapter.id,
          version,
          content: input.content,
          contentHash,
          wordCount,
          createdBy: userId,
          source: 'manual',
          createdAt: now,
        })
        .returning();
      await tx
        .update(chapters)
        .set({
          title: input.title ?? chapter.title,
          status: 'writing',
          currentVersionId: created.id,
          wordCount,
          autosaveContent: '',
          autosaveUpdatedAt: null,
          updatedAt: now,
        })
        .where(eq(chapters.id, chapter.id));
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
      return created;
    });
    await this.branchState.snapshotVersion(userId, workId, branchId, saved.id);

    return this.toVersionResponse(chapterNumber, saved);
  }

  async autosaveChapter(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    input: SaveChapterAutosaveInput,
  ) {
    await this.requireBranch(userId, workId, branchId);
    const outline = await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.ensureChapter(workId, branchId, chapterNumber, outline.title);
    const now = new Date();
    const wordCount = countCjkCharacters(input.content);
    const [updated] = await this.database.db
      .update(chapters)
      .set({
        autosaveContent: input.content,
        autosaveUpdatedAt: now,
        wordCount,
        status: input.content.trim() ? 'writing' : chapter.status,
        updatedAt: now,
      })
      .where(eq(chapters.id, chapter.id))
      .returning();

    return {
      content: updated.autosaveContent,
      wordCount,
      updatedAt: now.toISOString(),
    };
  }

  async updateChapterMetadata(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    input: UpdateChapterMetadataInput,
  ) {
    await this.requireBranch(userId, workId, branchId);
    const outline = await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.ensureChapter(workId, branchId, chapterNumber, outline.title);
    const [updated] = await this.database.db
      .update(chapters)
      .set({
        ...(input.title ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.hook !== undefined ? { hook: input.hook } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chapters.id, chapter.id))
      .returning();

    return {
      chapterNumber,
      title: updated.title,
      summary: updated.summary,
      hook: updated.hook,
      status: updated.status,
      statusLabel: CHAPTER_STATUS_LABELS[updated.status],
    };
  }

  async restoreVersion(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    versionId: string,
  ) {
    await this.requireBranch(userId, workId, branchId);
    const outline = await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.ensureChapter(workId, branchId, chapterNumber, outline.title);

    const restored = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chapter.id}))`);
      const [version] = await tx
        .select()
        .from(chapterVersions)
        .where(and(eq(chapterVersions.id, versionId), eq(chapterVersions.chapterId, chapter.id)))
        .limit(1);
      if (!version) {
        throw chapterGenerationError(
          HttpStatus.NOT_FOUND,
          'CHAPTER_VERSION_NOT_FOUND',
          'Chapter version not found',
        );
      }
      const [currentMax] = await tx
        .select({ version: max(chapterVersions.version) })
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, chapter.id));
      const nextVersion = Number(currentMax?.version ?? 0) + 1;
      const now = new Date();
      const [created] = await tx
        .insert(chapterVersions)
        .values({
          chapterId: chapter.id,
          version: nextVersion,
          content: version.content,
          contentHash: createHash('sha256').update(version.content).digest('hex'),
          wordCount: version.wordCount,
          modelConfigId: version.modelConfigId,
          createdBy: userId,
          source: 'restored',
          createdAt: now,
        })
        .returning();
      await tx
        .update(chapters)
        .set({
          currentVersionId: created.id,
          wordCount: created.wordCount,
          status: 'writing',
          autosaveContent: '',
          autosaveUpdatedAt: null,
          updatedAt: now,
        })
        .where(eq(chapters.id, chapter.id));
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
      return created;
    });
    await this.branchState.snapshotVersion(userId, workId, branchId, restored.id);

    return this.toVersionResponse(chapterNumber, restored);
  }

  async listVersions(userId: string, workId: string, branchId: string, chapterNumber: number) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);
    const [chapter] = await this.database.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
          eq(chapters.chapterNumber, chapterNumber),
        ),
      )
      .limit(1);
    if (!chapter) {
      return { items: [] };
    }
    const rows = await this.database.db
      .select()
      .from(chapterVersions)
      .where(eq(chapterVersions.chapterId, chapter.id))
      .orderBy(desc(chapterVersions.version));
    return {
      items: rows.map((row) => this.toVersionResponse(chapterNumber, row)),
    };
  }

  async listFactProposals(userId: string, workId: string, branchId: string, chapterNumber: number) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.findChapter(workId, branchId, chapterNumber);
    if (!chapter) {
      return { items: [] };
    }

    const rows = await this.database.db
      .select()
      .from(factProposals)
      .where(
        and(
          eq(factProposals.workId, workId),
          eq(factProposals.branchId, branchId),
          eq(factProposals.chapterId, chapter.id),
        ),
      )
      .orderBy(asc(factProposals.createdAt), asc(factProposals.type));

    return {
      items: rows.map((row) => this.toFactProposalResponse(chapterNumber, row)),
    };
  }

  async listContinuityIssues(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
  ) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.findChapter(workId, branchId, chapterNumber);
    if (!chapter) {
      return { items: [] };
    }

    const rows = await this.database.db
      .select({
        annotation: annotations,
        fact: facts,
        factChapterNumber: chapters.chapterNumber,
      })
      .from(annotations)
      .leftJoin(facts, eq(facts.id, annotations.factId))
      .leftJoin(chapters, eq(chapters.id, facts.chapterId))
      .where(
        and(
          eq(annotations.workId, workId),
          eq(annotations.branchId, branchId),
          eq(annotations.chapterId, chapter.id),
        ),
      )
      .orderBy(asc(annotations.createdAt), asc(annotations.startOffset));

    return {
      items: rows.map((row) => this.toContinuityIssueResponse(row)),
    };
  }

  async getWritingInsights(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
  ) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.findChapter(workId, branchId, chapterNumber);

    const [annotationRows, foreshadowRows, characterRows, qualityRows] = await Promise.all([
      chapter
        ? this.database.db
            .select({
              annotation: annotations,
              fact: facts,
              factChapterNumber: chapters.chapterNumber,
            })
            .from(annotations)
            .leftJoin(facts, eq(facts.id, annotations.factId))
            .leftJoin(chapters, eq(chapters.id, facts.chapterId))
            .where(
              and(
                eq(annotations.workId, workId),
                eq(annotations.branchId, branchId),
                eq(annotations.chapterId, chapter.id),
              ),
            )
            .orderBy(asc(annotations.status), asc(annotations.startOffset))
        : Promise.resolve([]),
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
        .limit(12),
      this.database.db
        .select({
          state: characterStates,
          name: entities.name,
        })
        .from(characterStates)
        .innerJoin(entities, eq(entities.id, characterStates.characterId))
        .where(and(eq(characterStates.workId, workId), eq(characterStates.branchId, branchId)))
        .orderBy(asc(entities.name)),
      chapter
        ? this.database.db
            .select()
            .from(qualityReports)
            .where(
              and(
                eq(qualityReports.workId, workId),
                eq(qualityReports.branchId, branchId),
                eq(qualityReports.chapterId, chapter.id),
              ),
            )
            .limit(1)
        : Promise.resolve([] as QualityReportRow[]),
    ]);

    const issues = annotationRows.map((row) => this.toContinuityIssueResponse(row));
    const continuityCategories = new Set<string>(CONTINUITY_ISSUE_CATEGORIES);
    return {
      suggestions: issues.filter((issue) => !continuityCategories.has(issue.category)),
      continuity: issues.filter((issue) => continuityCategories.has(issue.category)),
      qualityReport: qualityRows[0]
        ? this.toQualityReportResponse(chapterNumber, qualityRows[0])
        : null,
      foreshadows: foreshadowRows.map((foreshadow) => ({
        id: foreshadow.id,
        title: foreshadow.title,
        description: foreshadow.description,
        setupChapter: foreshadow.setupChapter,
        plannedPayoffChapter: foreshadow.plannedPayoffChapter,
        importanceLabel: foreshadow.importance === 'must' ? '必须回收' : '可选回收',
      })),
      characters: characterRows.map(({ state, name }) => ({
        id: state.characterId,
        name,
        body: state.body,
        power: state.power,
        location: state.location,
        possessions: state.possessions,
        disguise: state.disguise,
        knowledgeCount: state.knowledge.length,
        updatedAt: state.updatedAt.toISOString(),
      })),
    };
  }

  async getChapterQuality(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
  ): Promise<ChapterQualityReport | null> {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.findChapter(workId, branchId, chapterNumber);
    if (!chapter) {
      return null;
    }

    const [report] = await this.database.db
      .select()
      .from(qualityReports)
      .where(
        and(
          eq(qualityReports.workId, workId),
          eq(qualityReports.branchId, branchId),
          eq(qualityReports.chapterId, chapter.id),
        ),
      )
      .limit(1);
    return report ? this.toQualityReportResponse(chapterNumber, report) : null;
  }

  async ignoreContinuityIssue(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    annotationId: string,
    input: IgnoreContinuityIssueInput,
  ) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.findChapter(workId, branchId, chapterNumber);
    if (!chapter) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'CONTINUITY_ISSUE_NOT_FOUND',
        'Continuity issue not found',
      );
    }

    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${annotationId}))`);
      const [existing] = await tx
        .select()
        .from(annotations)
        .where(
          and(
            eq(annotations.id, annotationId),
            eq(annotations.workId, workId),
            eq(annotations.branchId, branchId),
            eq(annotations.chapterId, chapter.id),
          ),
        )
        .limit(1);
      if (!existing) {
        throw chapterGenerationError(
          HttpStatus.NOT_FOUND,
          'CONTINUITY_ISSUE_NOT_FOUND',
          'Continuity issue not found',
        );
      }

      const now = new Date();
      await tx
        .update(annotations)
        .set({
          status: 'ignored',
          ignoredReason: input.reason,
          ignoredAt: now,
        })
        .where(eq(annotations.id, annotationId));

      const [updated] = await tx
        .select({
          annotation: annotations,
          fact: facts,
          factChapterNumber: chapters.chapterNumber,
        })
        .from(annotations)
        .leftJoin(facts, eq(facts.id, annotations.factId))
        .leftJoin(chapters, eq(chapters.id, facts.chapterId))
        .where(eq(annotations.id, annotationId))
        .limit(1);
      if (!updated) {
        throw chapterGenerationError(
          HttpStatus.NOT_FOUND,
          'CONTINUITY_ISSUE_NOT_FOUND',
          'Continuity issue not found',
        );
      }
      return this.toContinuityIssueResponse(updated);
    });
  }

  async updateFactProposal(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    proposalId: string,
    statement: string,
  ) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);

    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${branchId}))`);
      const [proposal] = await tx
        .select()
        .from(factProposals)
        .where(
          and(
            eq(factProposals.id, proposalId),
            eq(factProposals.workId, workId),
            eq(factProposals.branchId, branchId),
          ),
        )
        .limit(1);
      if (!proposal) {
        throw chapterGenerationError(
          HttpStatus.NOT_FOUND,
          'FACT_PROPOSAL_NOT_FOUND',
          'Fact proposal not found',
        );
      }
      await this.requireProposalChapter(proposal.chapterId, workId, branchId, chapterNumber);
      if (proposal.status !== 'proposed') {
        throw chapterGenerationError(
          HttpStatus.CONFLICT,
          'FACT_PROPOSAL_NOT_EDITABLE',
          'This fact proposal has already been reviewed',
        );
      }

      const [updated] = await tx
        .update(factProposals)
        .set({ statement, updatedAt: new Date() })
        .where(and(eq(factProposals.id, proposal.id), eq(factProposals.status, 'proposed')))
        .returning();
      if (!updated) {
        throw chapterGenerationError(
          HttpStatus.CONFLICT,
          'FACT_PROPOSAL_NOT_EDITABLE',
          'This fact proposal has already been reviewed',
        );
      }
      return this.toFactProposalResponse(chapterNumber, updated);
    });
  }

  async rejectFactProposal(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    proposalId: string,
  ) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);

    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${branchId}))`);
      const [proposal] = await tx
        .select()
        .from(factProposals)
        .where(
          and(
            eq(factProposals.id, proposalId),
            eq(factProposals.workId, workId),
            eq(factProposals.branchId, branchId),
          ),
        )
        .limit(1);
      if (!proposal) {
        throw chapterGenerationError(
          HttpStatus.NOT_FOUND,
          'FACT_PROPOSAL_NOT_FOUND',
          'Fact proposal not found',
        );
      }
      await this.requireProposalChapter(proposal.chapterId, workId, branchId, chapterNumber);
      if (proposal.status !== 'proposed') {
        throw chapterGenerationError(
          HttpStatus.CONFLICT,
          'FACT_PROPOSAL_NOT_EDITABLE',
          'This fact proposal has already been reviewed',
        );
      }

      const [updated] = await tx
        .update(factProposals)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(and(eq(factProposals.id, proposal.id), eq(factProposals.status, 'proposed')))
        .returning();
      if (!updated) {
        throw chapterGenerationError(
          HttpStatus.CONFLICT,
          'FACT_PROPOSAL_NOT_EDITABLE',
          'This fact proposal has already been reviewed',
        );
      }
      return this.toFactProposalResponse(chapterNumber, updated);
    });
  }

  async listConfirmedFacts(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select({
        fact: facts,
        chapterNumber: chapters.chapterNumber,
      })
      .from(facts)
      .innerJoin(chapters, eq(chapters.id, facts.chapterId))
      .where(and(eq(facts.workId, workId), eq(facts.branchId, branchId)))
      .orderBy(asc(facts.createdAt));

    return {
      items: rows.map(({ fact, chapterNumber }) => ({
        id: fact.id,
        chapterNumber,
        type: fact.type,
        typeLabel: FACT_TYPE_LABELS[fact.type],
        statement: fact.statement,
        sourceSentence: fact.sourceSentence,
        confirmedAt: fact.createdAt.toISOString(),
      })),
    };
  }

  async confirmFactProposal(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    proposalId: string,
    input: ConfirmFactProposalInput,
  ) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);

    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${branchId}))`);
      const [proposal] = await tx
        .select()
        .from(factProposals)
        .where(
          and(
            eq(factProposals.id, proposalId),
            eq(factProposals.workId, workId),
            eq(factProposals.branchId, branchId),
          ),
        )
        .limit(1);
      if (!proposal) {
        throw chapterGenerationError(
          HttpStatus.NOT_FOUND,
          'FACT_PROPOSAL_NOT_FOUND',
          'Fact proposal not found',
        );
      }
      if (proposal.status === 'rejected') {
        throw chapterGenerationError(
          HttpStatus.CONFLICT,
          'FACT_PROPOSAL_REJECTED',
          'A rejected fact proposal cannot be confirmed',
        );
      }

      const [chapter] = await tx
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.id, proposal.chapterId),
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
            eq(chapters.chapterNumber, chapterNumber),
          ),
        )
        .limit(1);
      if (!chapter) {
        throw chapterGenerationError(
          HttpStatus.NOT_FOUND,
          'CHAPTER_NOT_FOUND',
          'Chapter not found',
        );
      }

      let [fact] =
        proposal.status === 'confirmed'
          ? await tx.select().from(facts).where(eq(facts.sourceProposalId, proposal.id)).limit(1)
          : [];

      if (proposal.status === 'confirmed') {
        const [existingCommit] = fact
          ? await tx
              .select()
              .from(canonCommits)
              .where(
                and(
                  eq(canonCommits.branchId, branchId),
                  sql`${canonCommits.eventLog} @> ${JSON.stringify([{ factId: fact.id }])}::jsonb`,
                ),
              )
              .orderBy(desc(canonCommits.createdAt))
              .limit(1)
          : [];
        return {
          proposal: this.toFactProposalResponse(chapterNumber, proposal),
          fact: this.toConfirmedFactResponse(chapterNumber, fact),
          canonCommit: existingCommit
            ? {
                id: existingCommit.id,
                snapshotId: existingCommit.snapshotId,
                createdAt: existingCommit.createdAt.toISOString(),
              }
            : null,
        };
      }

      const statement = input.statement ?? proposal.statement;
      const now = new Date();
      const factId = randomUUID();
      const commitId = randomUUID();
      const snapshotId = randomUUID();
      [fact] = await tx
        .insert(facts)
        .values({
          id: factId,
          workId,
          branchId,
          chapterId: chapter.id,
          sourceProposalId: proposal.id,
          type: proposal.type,
          statement,
          sourceSentence: proposal.sourceSentence,
          createdAt: now,
        })
        .returning();

      await tx.insert(canonCommits).values({
        id: commitId,
        workId,
        branchId,
        chapterId: chapter.id,
        snapshotId,
        message: `确认第 ${chapterNumber} 章事实`,
        eventLog: [
          {
            kind: 'fact_confirmed',
            proposalId: proposal.id,
            factId,
            type: proposal.type,
            statement,
            sourceSentence: proposal.sourceSentence,
          },
        ],
        createdBy: userId,
        createdAt: now,
      });

      const confirmedRows = await tx
        .select({
          fact: facts,
          chapterNumber: chapters.chapterNumber,
        })
        .from(facts)
        .innerJoin(chapters, eq(chapters.id, facts.chapterId))
        .where(and(eq(facts.workId, workId), eq(facts.branchId, branchId)))
        .orderBy(asc(facts.createdAt));
      await tx.insert(canonSnapshots).values({
        id: snapshotId,
        workId,
        branchId,
        commitId,
        snapshot: {
          facts: confirmedRows.map(({ fact: row, chapterNumber: number }) =>
            this.toConfirmedFactResponse(number, row),
          ),
        },
        createdAt: now,
      });

      const [updatedProposal] = await tx
        .update(factProposals)
        .set({ statement, status: 'confirmed', updatedAt: now })
        .where(eq(factProposals.id, proposal.id))
        .returning();
      await tx
        .update(workBranches)
        .set({ baseCommitId: commitId, updatedAt: now })
        .where(eq(workBranches.id, branchId));

      return {
        proposal: this.toFactProposalResponse(chapterNumber, updatedProposal),
        fact: this.toConfirmedFactResponse(chapterNumber, fact),
        canonCommit: {
          id: commitId,
          snapshotId,
          createdAt: now.toISOString(),
        },
      };
    });
  }

  async listCanonCommits(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select({
        commit: canonCommits,
        chapterNumber: chapters.chapterNumber,
      })
      .from(canonCommits)
      .innerJoin(chapters, eq(chapters.id, canonCommits.chapterId))
      .where(and(eq(canonCommits.workId, workId), eq(canonCommits.branchId, branchId)))
      .orderBy(desc(canonCommits.createdAt));

    return {
      items: rows.map(({ commit, chapterNumber }) => ({
        id: commit.id,
        chapterNumber,
        snapshotId: commit.snapshotId,
        message: commit.message,
        eventLog: commit.eventLog,
        createdAt: commit.createdAt.toISOString(),
      })),
    };
  }

  async getCanonSnapshot(userId: string, workId: string, branchId: string, snapshotId: string) {
    await this.requireBranch(userId, workId, branchId);
    const [row] = await this.database.db
      .select()
      .from(canonSnapshots)
      .where(
        and(
          eq(canonSnapshots.id, snapshotId),
          eq(canonSnapshots.workId, workId),
          eq(canonSnapshots.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'CANON_SNAPSHOT_NOT_FOUND',
        'Canon snapshot not found',
      );
    }
    return {
      id: row.id,
      commitId: row.commitId,
      facts: row.snapshot.facts ?? [],
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async ensureChapter(
    workId: string,
    branchId: string,
    chapterNumber: number,
    title?: string,
  ): Promise<ChapterRow> {
    const [chapter] = await this.database.db
      .insert(chapters)
      .values({
        workId,
        branchId,
        chapterNumber,
        title: title?.trim() || this.defaultChapterTitle(chapterNumber),
        status: 'planned',
      })
      .onConflictDoUpdate({
        target: [chapters.workId, chapters.branchId, chapters.chapterNumber],
        set: {
          updatedAt: new Date(),
        },
      })
      .returning();
    return chapter;
  }

  private async requireOutline(
    workId: string,
    branchId: string,
    chapterNumber: number,
  ): Promise<ChapterOutlineRow> {
    const [outline] = await this.database.db
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
    if (!outline) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'CHAPTER_OUTLINE_NOT_FOUND',
        'Save a chapter outline before opening the writing desk',
      );
    }
    return outline;
  }

  private async requireProposalChapter(
    chapterId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
  ) {
    const [chapter] = await this.database.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.id, chapterId),
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
          eq(chapters.chapterNumber, chapterNumber),
        ),
      )
      .limit(1);
    if (!chapter) {
      throw chapterGenerationError(HttpStatus.NOT_FOUND, 'CHAPTER_NOT_FOUND', 'Chapter not found');
    }
  }

  private async findChapter(
    workId: string,
    branchId: string,
    chapterNumber: number,
  ): Promise<ChapterRow | undefined> {
    const [chapter] = await this.database.db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
          eq(chapters.chapterNumber, chapterNumber),
        ),
      )
      .limit(1);
    return chapter;
  }

  private requireActionInput(action: ChapterGenerationAction, input: GenerateChapterInput) {
    const segmentActions: ChapterGenerationAction[] = [
      'rewrite',
      'expand',
      'condense',
      'change_pov',
    ];
    if (segmentActions.includes(action) && !input.selection?.trim()) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'SELECTION_REQUIRED',
        'Select chapter text before using this writing action',
      );
    }
    if (action === 'change_pov' && !input.targetPov?.trim() && !input.pov?.trim()) {
      throw chapterGenerationError(
        HttpStatus.BAD_REQUEST,
        'TARGET_POV_REQUIRED',
        'Choose the target point of view before changing it',
      );
    }
  }

  private async selectProseModelConfig(userId: string, modelConfigId?: string) {
    if (modelConfigId) {
      const [selected] = await this.database.db
        .select()
        .from(modelConfigs)
        .where(and(eq(modelConfigs.userId, userId), eq(modelConfigs.id, modelConfigId)))
        .limit(1);
      return selected;
    }
    const rows = await this.database.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.userId, userId))
      .orderBy(desc(modelConfigs.isDefault), modelConfigs.createdAt);
    return rows.find((row) => row.purpose === 'prose') ?? rows.find((row) => row.isDefault);
  }

  private async requireBranch(userId: string, workId: string, branchId: string): Promise<void> {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw chapterGenerationError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
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
          eq(jobs.userId, userId),
        ),
      )
      .limit(1);
    if (!job) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'GENERATION_JOB_NOT_FOUND',
        'Generation task not found',
      );
    }
    return job;
  }

  private defaultChapterTitle(chapterNumber: number): string {
    return `第 ${chapterNumber} 章`;
  }

  private toOutlineResponse(row: ChapterOutlineRow): ChapterOutlineResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      chapterNumber: row.chapterNumber ?? 0,
      chapterGoal: row.chapterGoal,
      pov: row.pov,
      sceneBeats: row.sceneBeats,
      chapterEndHook: row.chapterEndHook,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toVersionResponse(chapterNumber: number, row: ChapterVersionRow) {
    return {
      id: row.id,
      chapterNumber,
      version: row.version,
      content: row.content,
      contentHash: row.contentHash,
      wordCount: row.wordCount,
      source: row.source,
      modelConfigId: row.modelConfigId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toFactProposalResponse(chapterNumber: number, row: FactProposalRow) {
    return {
      id: row.id,
      chapterNumber,
      type: row.type,
      typeLabel: FACT_TYPE_LABELS[row.type],
      statement: row.statement,
      sourceSentence: row.sourceSentence,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toConfirmedFactResponse(
    chapterNumber: number,
    row: {
      id: string;
      type: (typeof facts.$inferSelect)['type'];
      statement: string;
      sourceSentence: string;
      createdAt: Date;
    },
  ) {
    return {
      id: row.id,
      chapterNumber,
      type: row.type,
      typeLabel: FACT_TYPE_LABELS[row.type],
      statement: row.statement,
      sourceSentence: row.sourceSentence,
      confirmedAt: row.createdAt.toISOString(),
    };
  }

  private toContinuityIssueResponse(row: {
    annotation: typeof annotations.$inferSelect;
    fact: typeof facts.$inferSelect | null;
    factChapterNumber: number | null;
  }) {
    const { annotation, fact, factChapterNumber } = row;
    return {
      id: annotation.id,
      category: annotation.category,
      categoryLabel: CONTINUITY_CATEGORY_LABELS[annotation.category] ?? '连续性',
      severity: annotation.severity,
      severityLabel: CONTINUITY_SEVERITY_LABELS[annotation.severity] ?? '需要确认',
      message: annotation.message,
      suggestion: annotation.suggestion,
      sourceSentence: annotation.sourceSentence,
      startOffset: annotation.startOffset,
      endOffset: annotation.endOffset,
      status: annotation.status,
      statusLabel: CONTINUITY_STATUS_LABELS[annotation.status],
      ignoredReason: annotation.ignoredReason,
      ignoredAt: annotation.ignoredAt?.toISOString() ?? null,
      confirmedFact: fact
        ? {
            id: fact.id,
            statement: fact.statement,
            chapterNumber: factChapterNumber ?? 0,
            typeLabel: FACT_TYPE_LABELS[fact.type],
          }
        : null,
      createdAt: annotation.createdAt.toISOString(),
    };
  }

  private toQualityReportResponse(
    chapterNumber: number,
    row: QualityReportRow,
  ): ChapterQualityReport {
    return {
      chapterNumber,
      generatedAt: row.updatedAt.toISOString(),
      summary: row.report.summary,
      dimensions: row.report.dimensions as ChapterQualityReport['dimensions'],
      issueCounts: row.report.issueCounts,
    };
  }
}
