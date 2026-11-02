import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CHAPTER_STATUS_LABELS,
  FACT_TYPE_LABELS,
  countCjkCharacters,
  type ChapterStatus,
  type ConfirmFactProposalInput,
  type GenerateChapterInput,
  type SaveChapterVersionInput,
} from '@novel/contracts';
import {
  canonCommits,
  canonSnapshots,
  chapterOutlines,
  chapterVersions,
  chapters,
  contextPacks,
  drafts,
  factProposals,
  facts,
  generationRequests,
  jobEvents,
  jobSteps,
  jobs,
  modelConfigs,
  workBranches,
  works,
  type ChapterOutlineRow,
  type ChapterRow,
  type ChapterVersionRow,
  type FactProposalRow,
  type JobRow,
} from '@novel/db';
import type { Queue } from 'bullmq';
import { and, asc, desc, eq, gt, isNull, max, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { chapterGenerationError } from './chapter-generation.errors';

const GENERATION_STEPS = [
  'readiness',
  'brief',
  'context',
  'draft',
  'extract_facts',
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
        and(eq(chapterOutlines.workId, workId), eq(chapterOutlines.branchId, branchId)),
      )
      .orderBy(chapterOutlines.chapterNumber);

    return {
      items: rows.map(({ outline, chapter }) => ({
        chapterNumber: outline.chapterNumber,
        title: chapter?.title ?? this.defaultChapterTitle(outline.chapterNumber),
        goal: outline.chapterGoal,
        status: chapter?.status ?? 'planned',
        statusLabel: CHAPTER_STATUS_LABELS[chapter?.status ?? 'planned'],
        wordCount: chapter?.wordCount ?? 0,
        hasContent: Boolean(chapter?.currentVersionId),
      })),
    };
  }

  async getChapter(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
  ) {
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
      title: chapter?.title ?? this.defaultChapterTitle(chapterNumber),
      status: chapter?.status ?? 'planned',
      statusLabel: CHAPTER_STATUS_LABELS[chapter?.status ?? 'planned'],
      wordCount: chapter?.wordCount ?? 0,
      content: currentVersion?.content ?? '',
      outline: this.toOutlineResponse(outline),
      currentVersion: currentVersion
        ? this.toVersionResponse(chapterNumber, currentVersion)
        : null,
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
      versions: versionRows.map((version) =>
        this.toVersionResponse(chapterNumber, version),
      ),
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
    await this.requireBranch(userId, workId, branchId);
    const outline = await this.requireOutline(workId, branchId, chapterNumber);
    const modelConfig = await this.selectProseModelConfig(userId);
    if (!modelConfig) {
      throw chapterGenerationError(
        HttpStatus.CONFLICT,
        'MODEL_CONFIG_REQUIRED',
        'Configure a prose model before generating',
      );
    }

    const chapter = await this.ensureChapter(workId, branchId, chapterNumber);
    const created = await this.database.db.transaction(async (tx) => {
      const now = new Date();
      const [generation] = await tx
        .insert(generationRequests)
        .values({
          workId,
          branchId,
          chapterId: chapter.id,
          type: 'chapter',
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
            targetMinCharacters: input.targetMinCharacters,
            targetMaxCharacters: input.targetMaxCharacters,
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
      await tx
        .update(works)
        .set({ updatedAt: now })
        .where(eq(works.id, workId));

      return { generation, job };
    });

    try {
      await this.generationQueue.add(
        'generate-chapter',
        { jobId: created.job.id },
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
      targetMinCharacters: Number(job.payload.targetMinCharacters ?? 0),
      targetMaxCharacters: Number(job.payload.targetMaxCharacters ?? 0),
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

  async saveVersion(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    input: SaveChapterVersionInput,
  ) {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.ensureChapter(workId, branchId, chapterNumber);
    const contentHash = createHash('sha256').update(input.content).digest('hex');
    const wordCount = countCjkCharacters(input.content);

    const saved = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${chapter.id}))`,
      );
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
          updatedAt: now,
        })
        .where(eq(chapters.id, chapter.id));
      await tx
        .update(works)
        .set({ updatedAt: now })
        .where(eq(works.id, workId));
      return created;
    });

    return this.toVersionResponse(chapterNumber, saved);
  }

  async listVersions(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
  ) {
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

  async listFactProposals(
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

  async updateFactProposal(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    proposalId: string,
    statement: string,
  ) {
    const proposal = await this.requireEditableProposal(
      userId,
      workId,
      branchId,
      chapterNumber,
      proposalId,
    );
    const [updated] = await this.database.db
      .update(factProposals)
      .set({ statement, updatedAt: new Date() })
      .where(eq(factProposals.id, proposal.id))
      .returning();
    return this.toFactProposalResponse(chapterNumber, updated);
  }

  async rejectFactProposal(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    proposalId: string,
  ) {
    const proposal = await this.requireEditableProposal(
      userId,
      workId,
      branchId,
      chapterNumber,
      proposalId,
    );
    const [updated] = await this.database.db
      .update(factProposals)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(factProposals.id, proposal.id))
      .returning();
    return this.toFactProposalResponse(chapterNumber, updated);
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
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${branchId}))`,
      );
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
          ? await tx
              .select()
              .from(facts)
              .where(eq(facts.sourceProposalId, proposal.id))
              .limit(1)
          : [];

      if (proposal.status === 'confirmed') {
        const [existingCommit] = fact
          ? await tx
              .select()
              .from(canonCommits)
              .where(
                and(
                  eq(canonCommits.branchId, branchId),
                  sql`${canonCommits.eventLog} @> ${JSON.stringify([
                    { factId: fact.id },
                  ])}::jsonb`,
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
      .where(
        and(eq(canonCommits.workId, workId), eq(canonCommits.branchId, branchId)),
      )
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

  async getCanonSnapshot(
    userId: string,
    workId: string,
    branchId: string,
    snapshotId: string,
  ) {
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
  ): Promise<ChapterRow> {
    const [chapter] = await this.database.db
      .insert(chapters)
      .values({
        workId,
        branchId,
        chapterNumber,
        title: this.defaultChapterTitle(chapterNumber),
        status: 'planned',
      })
      .onConflictDoUpdate({
        target: [chapters.workId, chapters.branchId, chapters.chapterNumber],
        set: { updatedAt: new Date() },
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

  private async requireEditableProposal(
    userId: string,
    workId: string,
    branchId: string,
    chapterNumber: number,
    proposalId: string,
  ): Promise<FactProposalRow> {
    await this.requireBranch(userId, workId, branchId);
    await this.requireOutline(workId, branchId, chapterNumber);
    const chapter = await this.findChapter(workId, branchId, chapterNumber);
    const proposal = chapter
      ? (
          await this.database.db
            .select()
            .from(factProposals)
            .where(
              and(
                eq(factProposals.id, proposalId),
                eq(factProposals.workId, workId),
                eq(factProposals.branchId, branchId),
                eq(factProposals.chapterId, chapter.id),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
    if (!proposal) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'FACT_PROPOSAL_NOT_FOUND',
        'Fact proposal not found',
      );
    }
    if (proposal.status !== 'proposed') {
      throw chapterGenerationError(
        HttpStatus.CONFLICT,
        'FACT_PROPOSAL_NOT_EDITABLE',
        'This fact proposal has already been reviewed',
      );
    }
    return proposal;
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

  private async selectProseModelConfig(userId: string) {
    const rows = await this.database.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.userId, userId))
      .orderBy(desc(modelConfigs.isDefault), modelConfigs.createdAt);
    return rows.find((row) => row.purpose === 'prose') ?? rows.find((row) => row.isDefault);
  }

  private async requireBranch(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<void> {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw chapterGenerationError(
        HttpStatus.NOT_FOUND,
        'WORK_NOT_FOUND',
        'Work not found',
      );
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
      chapterNumber: row.chapterNumber,
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
}
