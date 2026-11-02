import { Inject, Injectable } from '@nestjs/common';
import {
  AI_GATEWAY,
  AiGatewayError,
  extractChapterFacts,
  redactModelSecrets,
  type AiGateway,
} from '@novel/ai';
import {
  CHAPTER_ACTION_OUTPUT_KIND,
  countCjkCharacters,
  FACT_TYPE_LABELS,
  getGenrePackDefinition,
  getGenreSubtypeDefinition,
  DEFAULT_CHAPTER_TARGET_MAX,
  DEFAULT_CHAPTER_TARGET_MIN,
  QUALITY_TIER_LABELS,
  normalizeStoryBibleCards,
  type ChapterGenerationAction,
  type ChapterGenerationOutputKind,
  type WritingQualityTier,
} from '@novel/contracts';
import { auditChapterQuality, type ChapterQualityReport } from '@novel/core';
import {
  annotations,
  chapterOutlines,
  chapterVersions,
  chapters,
  contextPacks,
  drafts,
  entities,
  factProposals,
  facts,
  generationRequests,
  jobCheckpoints,
  jobEvents,
  jobSteps,
  jobs,
  qualityReports,
  storyBibles,
  works,
  type ChapterOutlineRow,
  type GenerationRequestRow,
  type JobRow,
  type StoryBibleRow,
} from '@novel/db';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { loadChapterAuditInput } from './chapter-audit-context';
import { selectContextFacts } from './context-fact-selection';
import { GenerationModelConfigResolver } from './generation-model-config.resolver';
import {
  loadHistoryGenerationContext,
  type HistoryGenerationContext,
} from './history-context';

type GenerationStepKey = 'readiness' | 'brief' | 'context' | 'draft' | 'extract_facts' | 'verify';

type GenerationErrorInfo = {
  code: string;
  message: string;
  recoverable: true;
  details?: Record<string, unknown>;
};

type ContextSection = {
  key: string;
  title: string;
  content: Record<string, unknown>;
};

type WritingSettings = {
  qualityTier: WritingQualityTier;
  modelConfigId: string | null;
  targetMinCharacters: number;
  targetMaxCharacters: number;
  pov: string | null;
  targetPov: string | null;
  mustInclude: string[];
  mustAvoid: string[];
  referenceChapters: number[];
  tabooWords: string[];
  cursorOffset: number | null;
  selectionStart: number | null;
  selectionEnd: number | null;
};

const GENERATION_STEP_ORDER = [
  'readiness',
  'brief',
  'context',
  'draft',
  'extract_facts',
  'verify',
] as const;

export type GenerationRunResult = {
  ok: boolean;
  draftId?: string;
  promptTokens?: number;
  completionTokens?: number;
  continuityIssueCount?: number;
  error?: GenerationErrorInfo;
};

@Injectable()
export class ChapterGenerationRunner {
  constructor(
    private readonly database: DatabaseService,
    private readonly modelResolver: GenerationModelConfigResolver,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
  ) {}

  async run(jobId: string, options: { retry?: boolean } = {}): Promise<GenerationRunResult> {
    const jobRow = await this.requireVisibleJob(jobId);
    if (jobRow.status === 'completed') {
      return { ok: true };
    }
    if (jobRow.status === 'failed' && !options.retry) {
      return {
        ok: false,
        ...(jobRow.error ? { error: jobRow.error as GenerationErrorInfo } : {}),
      };
    }

    const existingSteps = await this.database.db
      .select()
      .from(jobSteps)
      .where(eq(jobSteps.jobId, jobId))
      .orderBy(asc(jobSteps.position));
    if (options.retry) {
      const retryAt = new Date();
      const failedStep = existingSteps.find((step) => step.status === 'failed');
      if (failedStep) {
        await this.database.db
          .update(jobSteps)
          .set({
            status: 'pending',
            error: null,
            finishedAt: null,
          })
          .where(eq(jobSteps.id, failedStep.id));
      }
      await this.database.db
        .update(jobs)
        .set({
          status: 'preparing',
          error: null,
          finishedAt: null,
          updatedAt: retryAt,
        })
        .where(eq(jobs.id, jobId));
      await this.appendEvent(jobId, 'job.retry', {
        fromStep: failedStep?.stepKey ?? null,
      });
    }

    const [generation] = await this.database.db
      .select()
      .from(generationRequests)
      .where(eq(generationRequests.jobId, jobId))
      .limit(1);
    if (!generation) {
      throw new Error(`Generation request for job ${jobId} was not found`);
    }

    const [outline] = await this.database.db
      .select()
      .from(chapterOutlines)
      .where(
        and(
          eq(chapterOutlines.workId, generation.workId),
          eq(chapterOutlines.branchId, generation.branchId),
          eq(chapterOutlines.chapterNumber, Number(jobRow.payload.chapterNumber ?? 0)),
          eq(chapterOutlines.level, 'chapter'),
        ),
      )
      .limit(1);
    if (!outline) {
      return this.fail(jobRow, generation, undefined, {
        code: 'CHAPTER_OUTLINE_NOT_FOUND',
        message: 'Save a chapter outline before generating',
        recoverable: true,
      });
    }

    const now = new Date();
    await this.database.db
      .update(jobs)
      .set({
        status: 'preparing',
        progress: 5,
        attempts: jobRow.attempts + 1,
        startedAt: jobRow.startedAt ?? now,
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId));
    await this.appendEvent(jobId, 'job.preparing', { progress: 5 });

    const targetMinCharacters = this.targetValue(
      jobRow.payload.targetMinCharacters,
      DEFAULT_CHAPTER_TARGET_MIN,
    );
    const targetMaxCharacters = this.targetValue(
      jobRow.payload.targetMaxCharacters,
      DEFAULT_CHAPTER_TARGET_MAX,
    );
    const action = this.actionValue(jobRow.payload.action);
    const outputKind = this.outputKindValue(jobRow.payload.outputKind, action);
    const settings = this.writingSettings(jobRow.payload.settings, {
      targetMinCharacters,
      targetMaxCharacters,
    });
    const failedStepKey = existingSteps.find((step) => step.status === 'failed')?.stepKey;
    const resumeIndex =
      options.retry && failedStepKey
        ? GENERATION_STEP_ORDER.indexOf(failedStepKey as (typeof GENERATION_STEP_ORDER)[number])
        : -1;
    const shouldRunStep = (stepKey: (typeof GENERATION_STEP_ORDER)[number]) =>
      !options.retry || resumeIndex < 0
        ? true
        : GENERATION_STEP_ORDER.indexOf(stepKey) >= resumeIndex;
    let draftId: string | undefined;
    let draftContent = '';
    let lastPersistedContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let proposalCount = 0;
    try {
      const [bible] = await this.database.db
        .select()
        .from(storyBibles)
        .where(
          and(
            eq(storyBibles.workId, generation.workId),
            eq(storyBibles.branchId, generation.branchId),
          ),
        )
        .limit(1);

      if (!bible) {
        throw new InvalidGenerationInput(
          'STORY_BIBLE_REQUIRED',
          'Save the story bible before generating a chapter',
        );
      }
      if (shouldRunStep('readiness')) {
        await this.beginStep(jobId, 'readiness', { outlineId: outline.id }, 10);
      }
      const model = await this.modelResolver.resolve(
        generation.createdBy,
        settings.modelConfigId ?? undefined,
      );
      if (shouldRunStep('readiness')) {
        await this.completeStep(
          jobId,
          'readiness',
          {
            model: model.model,
            storyBibleReady: true,
            outlineReady: true,
          },
          15,
        );
      }

      const brief = {
        goal: outline.chapterGoal,
        pov: outline.pov,
        sceneBeats: outline.sceneBeats,
        chapterEndHook: outline.chapterEndHook,
      };
      if (shouldRunStep('brief')) {
        await this.beginStep(jobId, 'brief', { outlineId: outline.id }, 20);
        await this.completeStep(jobId, 'brief', brief, 30);
      }

      if (shouldRunStep('context')) {
        await this.beginStep(jobId, 'context', { outlineId: outline.id }, 35);
      }
      const confirmedFactRows = await this.database.db
        .select({
          fact: facts,
          chapterNumber: chapters.chapterNumber,
        })
        .from(facts)
        .innerJoin(chapters, eq(chapters.id, facts.chapterId))
        .where(and(eq(facts.workId, generation.workId), eq(facts.branchId, generation.branchId)))
        .orderBy(asc(facts.createdAt));
      const [work] = await this.database.db
        .select({ genrePack: works.genrePack, title: works.title })
        .from(works)
        .where(eq(works.id, generation.workId))
        .limit(1);
      const historyContext =
        work?.genrePack === 'history'
          ? await loadHistoryGenerationContext(
              this.database,
              generation.workId,
              generation.branchId,
            )
          : null;
      const urbanSettingRows =
        work?.genrePack === 'urban'
          ? await this.database.db
              .select()
              .from(entities)
              .where(
                and(
                  eq(entities.workId, generation.workId),
                  eq(entities.branchId, generation.branchId),
                  ne(entities.subtype, ''),
                  isNull(entities.deletedAt),
                ),
              )
              .orderBy(asc(entities.name))
          : [];
      const contextFacts = selectContextFacts(
        confirmedFactRows.map(({ fact, chapterNumber }) => ({
          id: fact.id,
          chapterNumber,
          type: fact.type,
          typeLabel: FACT_TYPE_LABELS[fact.type],
          statement: fact.statement,
          sourceSentence: fact.sourceSentence,
        })),
        {
          chapterNumber: outline.chapterNumber ?? Number(jobRow.payload.chapterNumber ?? 0),
          chapterGoal: outline.chapterGoal,
          pov: outline.pov,
          sceneBeats: outline.sceneBeats,
          chapterEndHook: outline.chapterEndHook,
        },
        {
          mustInclude: settings.mustInclude,
          mustAvoid: settings.mustAvoid,
        },
      );
      const context = this.compileContext(
        bible,
        outline,
        generation,
        targetMinCharacters,
        targetMaxCharacters,
        action,
        outputKind,
        settings,
        await this.referenceChapterContext(
          generation.workId,
          generation.branchId,
          settings.referenceChapters,
        ),
        jobRow.payload,
        contextFacts,
        work?.genrePack ?? '',
        urbanSettingRows.map((setting) => ({
          id: setting.id,
          name: setting.name,
          subtype: setting.subtype,
          subtypeLabel:
            getGenreSubtypeDefinition('urban', setting.subtype)?.label ?? setting.subtype,
          summary: setting.summary,
          description: setting.description,
          fields: setting.customFields,
        })),
        historyContext,
      );
      if (shouldRunStep('context')) {
        await this.database.db
          .insert(contextPacks)
          .values({
            generationRequestId: generation.id,
            tokenBudget: 4_000,
            sections: context.sections,
            sourceRefs: context.sourceRefs,
          })
          .onConflictDoUpdate({
            target: contextPacks.generationRequestId,
            set: {
              tokenBudget: 4_000,
              sections: context.sections,
              sourceRefs: context.sourceRefs,
            },
          });
        await this.completeStep(
          jobId,
          'context',
          {
            sectionKeys: context.sections.map((section) => section.key),
            sourceRefs: context.sourceRefs,
          },
          45,
        );
      }

      const enforceLength = outputKind === 'chapter' || outputKind === 'segment';
      const maxAttempts = enforceLength ? 2 : 1;
      let attempts = 0;
      let characterCount = 0;
      let accepted = false;
      const reusableDraft =
        options.retry && !shouldRunStep('draft')
          ? (
              await this.database.db
                .select()
                .from(drafts)
                .where(eq(drafts.generationRequestId, generation.id))
                .limit(1)
            )[0]
          : undefined;

      if (reusableDraft?.content.trim()) {
        draftId = reusableDraft.id;
        draftContent = reusableDraft.content;
        characterCount = countCjkCharacters(draftContent);
        attempts = 1;
        accepted = true;
        await this.appendEvent(jobId, 'job.draft.reused', {
          draftId,
          fromStep: 'verify',
        });
      } else {
        await this.beginStep(jobId, 'draft', { modelConfigId: model.id }, 50);
        const [createdDraft] = await this.database.db
          .insert(drafts)
          .values({
            generationRequestId: generation.id,
            chapterId: generation.chapterId,
            content: '',
            status: 'streaming',
          })
          .onConflictDoUpdate({
            target: drafts.generationRequestId,
            set: {
              content: '',
              status: 'streaming',
              updatedAt: new Date(),
            },
          })
          .returning();
        draftId = createdDraft.id;

        await this.database.db
          .update(generationRequests)
          .set({
            status: 'running',
            modelConfigId: model.id,
            updatedAt: new Date(),
          })
          .where(eq(generationRequests.id, generation.id));

        while (attempts < maxAttempts && !accepted) {
          attempts += 1;
          if (attempts > 1) {
            lastPersistedContent = draftContent;
            draftContent = '';
            await this.database.db
              .update(drafts)
              .set({ content: '', status: 'streaming', updatedAt: new Date() })
              .where(eq(drafts.id, draftId));
            await this.appendEvent(jobId, 'job.draft.reset', {
              reason: 'length_bounds',
              attempt: attempts,
              previousCharacterCount: characterCount,
              targetMinCharacters,
              targetMaxCharacters,
            });
          }

          const prompt =
            attempts === 1
              ? context.userPrompt
              : this.correctionPrompt(
                  context.userPrompt,
                  characterCount,
                  targetMinCharacters,
                  targetMaxCharacters,
                );
          let chunkCount = 0;
          for await (const chunk of this.gateway.streamText({
            system: context.systemPrompt,
            prompt,
            model: model.model,
            apiKey: model.apiKey,
            baseUrl: model.baseUrl,
            maxTokens: 4_000,
            temperature: 0.75,
          })) {
            if (chunk.usage) {
              promptTokens += chunk.usage.promptTokens ?? 0;
              completionTokens += chunk.usage.completionTokens ?? 0;
            }
            if (!chunk.text) {
              continue;
            }
            draftContent += chunk.text;
            chunkCount += 1;
            await this.database.db
              .update(drafts)
              .set({ content: draftContent, updatedAt: new Date() })
              .where(eq(drafts.id, draftId));
            await this.appendEvent(jobId, 'job.draft.delta', {
              delta: chunk.text,
              characterCount: countCjkCharacters(draftContent),
            });
            if (chunkCount % 4 === 0) {
              await this.database.db
                .update(jobs)
                .set({
                  status: 'running',
                  progress: Math.min(95, 50 + Math.floor(chunkCount / 2)),
                  updatedAt: new Date(),
                })
                .where(eq(jobs.id, jobId));
            }
          }

          if (!draftContent.trim()) {
            throw new InvalidGenerationInput(
              'EMPTY_GENERATION',
              'The model did not return any chapter text',
            );
          }

          characterCount = countCjkCharacters(draftContent);
          if (
            !enforceLength ||
            (characterCount >= targetMinCharacters && characterCount <= targetMaxCharacters)
          ) {
            accepted = true;
            break;
          }

          if (enforceLength && attempts < maxAttempts) {
            await this.appendEvent(jobId, 'job.draft.correcting', {
              characterCount,
              targetMinCharacters,
              targetMaxCharacters,
              nextAttempt: attempts + 1,
            });
          }
        }

        if (!accepted && enforceLength) {
          throw new InvalidGenerationInput(
            'DRAFT_LENGTH_OUT_OF_BOUNDS',
            'The chapter did not meet the requested length bounds',
            {
              characterCount,
              targetMinCharacters,
              targetMaxCharacters,
              attempts,
            },
          );
        }

        await this.database.db
          .update(drafts)
          .set({ content: draftContent, status: 'ready', updatedAt: new Date() })
          .where(eq(drafts.id, draftId));
        await this.completeStep(
          jobId,
          'draft',
          {
            draftId,
            wordCount: characterCount,
            characterCount,
            targetMinCharacters,
            targetMaxCharacters,
            attempts,
          },
          98,
        );
      }

      let extracted: Awaited<ReturnType<typeof extractChapterFacts>> = { facts: [] };
      if (action === 'chapter' && options.retry && !shouldRunStep('extract_facts')) {
        const existingProposals = await this.database.db
          .select({ id: factProposals.id })
          .from(factProposals)
          .where(
            and(
              eq(factProposals.chapterId, generation.chapterId),
              eq(factProposals.status, 'proposed'),
            ),
          );
        proposalCount = existingProposals.length;
        await this.appendEvent(jobId, 'job.fact_extraction.reused', {
          proposalCount,
        });
      } else if (action === 'chapter') {
        await this.beginStep(jobId, 'extract_facts', { draftId }, 98);
        extracted = await extractChapterFacts(this.gateway, {
          chapterNumber: Number(jobRow.payload.chapterNumber),
          chapterText: draftContent,
          storyBible: {
            protagonist: bible.protagonist,
            worldIronLaw: bible.worldIronLaw,
          },
        });
        proposalCount = extracted.facts.length;
        await this.database.db.transaction(async (tx) => {
          await tx
            .delete(factProposals)
            .where(
              and(
                eq(factProposals.chapterId, generation.chapterId),
                eq(factProposals.status, 'proposed'),
              ),
            );
          const now = new Date();
          if (extracted.facts.length > 0) {
            await tx.insert(factProposals).values(
              extracted.facts.map((fact) => ({
                workId: generation.workId,
                branchId: generation.branchId,
                chapterId: generation.chapterId,
                generationRequestId: generation.id,
                type: fact.type,
                statement: fact.statement,
                sourceSentence: fact.sourceSentence,
                status: 'proposed' as const,
                createdAt: now,
                updatedAt: now,
              })),
            );
          }
        });
        await this.completeStep(
          jobId,
          'extract_facts',
          {
            proposalCount: extracted.facts.length,
            types: [...new Set(extracted.facts.map((fact) => fact.type))],
          },
          99,
        );
      } else {
        await this.skipStep(jobId, 'extract_facts', { reason: 'not_a_full_chapter' });
      }

      await this.beginStep(jobId, 'verify', { draftId }, 99);
      const audit =
        action === 'chapter'
          ? auditChapterQuality(
              await loadChapterAuditInput(
                this.database,
                generation.workId,
                generation.branchId,
                Number(jobRow.payload.chapterNumber),
                draftContent,
                {
                  chapterGoal: outline.chapterGoal,
                  pov: outline.pov,
                  sceneBeats: outline.sceneBeats,
                  chapterEndHook: outline.chapterEndHook,
                },
                confirmedFactRows.map(({ fact, chapterNumber }) => ({
                  id: fact.id,
                  chapterNumber,
                  type: fact.type,
                  statement: fact.statement,
                  sourceSentence: fact.sourceSentence,
                })),
                work?.genrePack ?? '',
              ),
            )
          : { issues: [], report: null as ChapterQualityReport | null };
      const tabooIssues = this.detectTabooIssues(
        draftContent,
        settings.tabooWords,
        generation,
        draftId,
      );
      await this.database.db.transaction(async (tx) => {
        await tx.delete(annotations).where(eq(annotations.chapterId, generation.chapterId));
        if (audit.issues.length > 0 || tabooIssues.length > 0) {
          await tx.insert(annotations).values([
            ...audit.issues.map((issue) => ({
              workId: generation.workId,
              branchId: generation.branchId,
              chapterId: generation.chapterId,
              generationRequestId: generation.id,
              draftId,
              factId: issue.factId,
              category: issue.category,
              severity: issue.severity,
              message: issue.message,
              suggestion: issue.suggestion,
              sourceSentence: issue.sourceSentence,
              startOffset: issue.startOffset,
              endOffset: issue.endOffset,
              status: 'open' as const,
            })),
            ...tabooIssues,
          ]);
        }
        if (audit.report) {
          const now = new Date();
          await tx
            .insert(qualityReports)
            .values({
              workId: generation.workId,
              branchId: generation.branchId,
              chapterId: generation.chapterId,
              generationRequestId: generation.id,
              draftId: draftId ?? null,
              report: audit.report,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: qualityReports.chapterId,
              set: {
                generationRequestId: generation.id,
                draftId: draftId ?? null,
                report: audit.report,
                updatedAt: now,
              },
            });
        }
      });
      const issueCount = audit.issues.length + tabooIssues.length;
      await this.completeStep(
        jobId,
        'verify',
        {
          issueCount,
          categories: [
            ...new Set([
              ...audit.issues.map((issue) => issue.category),
              ...tabooIssues.map((issue) => issue.category),
            ]),
          ],
          qualityStatus: audit.report
            ? (audit.report.dimensions.find((dimension) => dimension.key === 'continuity')
                ?.status ?? null)
            : null,
        },
        99,
      );

      const completedAt = new Date();
      await this.appendEvent(jobId, 'job.completed', {
        draftId,
        wordCount: characterCount,
        characterCount,
        targetMinCharacters,
        targetMaxCharacters,
        attempts,
        proposalCount,
        continuityIssueCount: issueCount,
        action,
        outputKind,
        progress: 100,
      });
      await this.database.db
        .update(jobs)
        .set({
          status: 'completed',
          progress: 100,
          checkpoint: { stepKey: 'verify' },
          finishedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(jobs.id, jobId));
      await this.database.db
        .update(generationRequests)
        .set({
          status: 'completed',
          finishedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(generationRequests.id, generation.id));

      return {
        ok: true,
        ...(draftId ? { draftId } : {}),
        promptTokens,
        completionTokens,
        continuityIssueCount: issueCount,
      };
    } catch (error) {
      const errorInfo = this.toErrorInfo(error);
      if (draftId) {
        const preservedContent =
          draftContent.trim().length > 0 ? draftContent : lastPersistedContent;
        await this.database.db
          .update(drafts)
          .set({
            ...(preservedContent ? { content: preservedContent } : {}),
            status: 'failed',
            updatedAt: new Date(),
          })
          .where(eq(drafts.id, draftId));
      }
      await this.fail(jobRow, generation, draftId, errorInfo);
      return {
        ok: false,
        ...(draftId ? { draftId } : {}),
        promptTokens,
        completionTokens,
        error: errorInfo,
      };
    }
  }

  private compileContext(
    bible: StoryBibleRow,
    outline: ChapterOutlineRow,
    generation: GenerationRequestRow,
    targetMinCharacters: number,
    targetMaxCharacters: number,
    action: ChapterGenerationAction,
    outputKind: ChapterGenerationOutputKind,
    settings: WritingSettings,
    referenceChapters: Array<{
      chapterNumber: number;
      title: string;
      summary: string;
      content: string;
    }>,
    jobPayload: Record<string, unknown>,
    confirmedFacts: Array<{
      id: string;
      chapterNumber: number;
      type: string;
      typeLabel: string;
      statement: string;
      sourceSentence: string;
    }>,
    genrePack: string,
    urbanSettings: Array<{
      id: string;
      name: string;
      subtype: string;
      subtypeLabel: string;
      summary: string;
      description: string;
      fields: Record<string, unknown>;
    }>,
    historyContext: HistoryGenerationContext | null,
  ): {
    sections: ContextSection[];
    sourceRefs: string[];
    systemPrompt: string;
    userPrompt: string;
  } {
    const storyBibleCards = normalizeStoryBibleCards(bible.cards, bible).filter(
      (card) => card.summary || card.details,
    );
    const storyBiblePrompt = storyBibleCards
      .map(
        (card) =>
          `${card.title}：${card.summary}${card.details ? `\n详细设定：${card.details}` : ''}`,
      )
      .join('\n');
    const genreDefinition = getGenrePackDefinition(genrePack);
    const isUrban = genreDefinition?.key === 'urban';
    const sections: ContextSection[] = [
      {
        key: 'storyBible',
        title: '故事圣经',
        content: {
          cards: storyBibleCards,
          oneSentenceStory: bible.oneSentenceStory,
          protagonist: bible.protagonist,
          worldIronLaw: bible.worldIronLaw,
        },
      },
      {
        key: 'chapterOutline',
        title: '本章章纲',
        content: {
          chapterGoal: outline.chapterGoal,
          pov: outline.pov,
          sceneBeats: outline.sceneBeats,
          chapterEndHook: outline.chapterEndHook,
        },
      },
      ...(genreDefinition
        ? [
            {
              key: 'genrePack',
              title: '题材模板',
              content: {
                key: genreDefinition.key,
                label: genreDefinition.label,
                templateKey: genreDefinition.template.key,
                templateName: genreDefinition.template.name,
                summary: genreDefinition.template.summary,
                writingGuide: genreDefinition.template.writingGuide,
                checkCategories: genreDefinition.template.checkCategories,
              },
            },
          ]
        : []),
      ...(urbanSettings.length > 0
        ? [
            {
              key: 'urbanSettings',
              title: '都市相关设定',
              content: {
                settings: urbanSettings,
              },
            },
          ]
        : []),
      ...(historyContext
        ? [
            {
              key: 'historyPack',
              title: '历史题材规则',
              content: {
                mainTemplate: historyContext.mainTemplate,
                variant: historyContext.variant,
                variantLabel: historyContext.variantLabel,
                rules: [
                  '只写架空古代，不绑定真实朝代与真实人物。',
                  '不得出现现代器物、现代机构或网络词汇。',
                  '官职高低、隶属关系和调兵权限必须符合设定。',
                  '军队移动必须经过地图道路，并核算行程与粮草。',
                ],
                settings: historyContext.settings,
              },
            },
          ]
        : []),
      ...(confirmedFacts.length > 0
        ? [
            {
              key: 'confirmedFacts',
              title: '已确认设定',
              content: {
                facts: confirmedFacts,
              },
            },
          ]
        : []),
      {
        key: 'writingControls',
        title: '写作控制',
        content: {
          qualityTier: settings.qualityTier,
          qualityTierLabel: QUALITY_TIER_LABELS[settings.qualityTier],
          pov: settings.targetPov ?? settings.pov ?? outline.pov,
          mustInclude: settings.mustInclude,
          mustAvoid: settings.mustAvoid,
          referenceChapters: settings.referenceChapters,
          tabooWords: settings.tabooWords,
          action,
          outputKind,
        },
      },
      ...(referenceChapters.length > 0
        ? [
            {
              key: 'referenceChapters',
              title: '参考章节',
              content: {
                chapters: referenceChapters,
              },
            },
          ]
        : []),
      {
        key: 'writingGuidance',
        title: '写作要求',
        content: {
          targetMinCharacters,
          targetMaxCharacters,
          targetCharacters: `${targetMinCharacters} 到 ${targetMaxCharacters} 个汉字`,
          instruction: generation.instruction ?? '',
          output: '只输出章节正文，不解释创作过程。',
          qualityTier: settings.qualityTier,
          pov: settings.targetPov ?? settings.pov ?? outline.pov,
          mustInclude: settings.mustInclude,
          mustAvoid: settings.mustAvoid,
          tabooWords: settings.tabooWords,
        },
      },
    ];

    const systemPrompt = [
      '你是一位擅长中文长篇网络小说的作者。',
      '请严格依据作者提供的创作资料写作，保持人物、世界规则和前文事实一致。',
      ...(historyContext
        ? [
            '这是一部历史题材小说。故事发生在架空古代，不要写入现代器物、现代制度或网络词汇。',
            '涉及官制、军队调动、粮草和地理距离时，必须遵守给定的历史题材规则。',
          ]
        : []),
      ...(outputKind === 'chapter' || outputKind === 'segment'
        ? [
            `正文必须包含 ${targetMinCharacters} 到 ${targetMaxCharacters} 个汉字；标点、空格和换行不计入汉字数量。`,
          ]
        : []),
      '只输出可以直接进入编辑器的内容，不要说明、Markdown 代码块或创作分析。',
    ].join('\n');
    const effectivePov = settings.targetPov ?? settings.pov ?? outline.pov;
    const sharedMaterials = [
      '【故事圣经】',
      storyBiblePrompt,
      ...(historyContext
        ? [
            '',
            '【历史题材规则】',
            `主模板：${historyContext.mainTemplate}`,
            `作品方向：${historyContext.variantLabel}`,
            '时代边界：架空古代；不得出现手机、互联网、公司、警察等现代事物与制度。',
            '官制：官职有明确品级和上下级，调令不能越过应有的官署。',
            '军制：军队有兵力与随军粮草，行军必须走地图道路并核算天数。',
            ...(historyContext.settings.length > 0
              ? [
                  '【历史设定】',
                  ...historyContext.settings.map(
                    (setting) =>
                      `- ${setting.subtypeLabel}·${setting.name}：${setting.summary || '无摘要'}${
                        Object.keys(setting.customFields).length > 0
                          ? `；字段：${JSON.stringify(setting.customFields)}`
                          : ''
                      }`,
                  ),
                ]
              : []),
          ]
        : []),
      ...(isUrban
        ? [
            '',
            '【都市题材创作要求】',
            ...(genreDefinition?.template.writingGuide.map((guide) => `- ${guide}`) ?? []),
            '- 检查现实逻辑、社会关系、金钱约束和法律约束；涉及通勤、付款、合同和冲突时写清条件和后果。',
            ...(urbanSettings.length > 0
              ? [
                  '',
                  '【都市相关设定】',
                  ...urbanSettings.map(
                    (setting) =>
                      `- ${setting.subtypeLabel}｜${setting.name}：${setting.summary || '无摘要'}${
                        Object.keys(setting.fields).length > 0
                          ? `\n  字段：${JSON.stringify(setting.fields)}`
                          : ''
                      }`,
                  ),
                ]
              : []),
          ]
        : []),
      '',
      '【本章章纲】',
      `章目标：${outline.chapterGoal}`,
      `叙事视角：${effectivePov}`,
      `场景节拍：${outline.sceneBeats.join('；')}`,
      `章末钩子：${outline.chapterEndHook}`,
      ...(confirmedFacts.length > 0
        ? [
            '',
            '【已确认设定】',
            ...confirmedFacts.map(
              (fact) => `- ${fact.typeLabel}（第 ${fact.chapterNumber} 章）：${fact.statement}`,
            ),
          ]
        : []),
      '',
      '【写作控制】',
      `质量档位：${QUALITY_TIER_LABELS[settings.qualityTier]}`,
      ...(settings.mustInclude.length > 0 ? [`必须包含：${settings.mustInclude.join('、')}`] : []),
      ...(settings.mustAvoid.length > 0 ? [`必须避免：${settings.mustAvoid.join('、')}`] : []),
      ...(settings.tabooWords.length > 0 ? [`禁忌词：${settings.tabooWords.join('、')}`] : []),
      ...(referenceChapters.length > 0
        ? [
            '',
            '【参考章节】',
            ...referenceChapters.map(
              (chapter) =>
                `第 ${chapter.chapterNumber} 章《${chapter.title}》\n摘要：${chapter.summary || '无'}\n节选：${chapter.content}`,
            ),
          ]
        : []),
      ...(generation.instruction ? ['', '【作者补充要求】', generation.instruction] : []),
    ].join('\n');
    const userPrompt = [
      this.actionInstruction(
        action,
        effectivePov,
        targetMinCharacters,
        targetMaxCharacters,
        jobPayload,
      ),
      '',
      sharedMaterials,
    ].join('\n');

    return {
      sections,
      sourceRefs: [
        `story_bible:${bible.id}`,
        `chapter_outline:${outline.id}`,
        ...referenceChapters.map((chapter) => `chapter:${chapter.chapterNumber}`),
        ...confirmedFacts.map((fact) => `fact:${fact.id}`),
        ...urbanSettings.map((setting) => `entity:${setting.id}`),
        ...(historyContext
          ? [
              `history_pack:${historyContext.variant}`,
              ...historyContext.settings.map((setting) => `history_setting:${setting.id}`),
            ]
          : []),
      ],
      systemPrompt,
      userPrompt,
    };
  }

  private actionInstruction(
    action: ChapterGenerationAction,
    pov: string,
    targetMinCharacters: number,
    targetMaxCharacters: number,
    payload: Record<string, unknown>,
  ): string {
    const content = typeof payload.content === 'string' ? payload.content : '';
    const selection = typeof payload.selection === 'string' ? payload.selection : '';
    const cursorOffset =
      typeof payload.cursorOffset === 'number' ? payload.cursorOffset : content.length;
    const targetLength = `目标汉字数：${targetMinCharacters} 到 ${targetMaxCharacters}。`;

    switch (action) {
      case 'continue':
        return [
          '【续写要求】',
          '从作者给出的光标位置继续写下去，不要重复光标前的正文。',
          targetLength,
          `【光标位置】${cursorOffset}`,
          '【光标前正文】',
          content.slice(0, cursorOffset),
        ].join('\n');
      case 'rewrite':
        return [
          '【改写要求】',
          '在保持情节事实不变的前提下重写选中文字，只输出替换后的文字。',
          targetLength,
          `【选中文字】\n${selection}`,
          `【所在正文】\n${content}`,
        ].join('\n');
      case 'expand':
        return [
          '【扩写要求】',
          '补充动作、感官和情绪细节，扩写选中文字，只输出替换后的文字。',
          targetLength,
          `【选中文字】\n${selection}`,
          `【所在正文】\n${content}`,
        ].join('\n');
      case 'condense':
        return [
          '【缩写要求】',
          '保留关键信息和语气，压缩选中文字，只输出替换后的文字。',
          targetLength,
          `【选中文字】\n${selection}`,
          `【所在正文】\n${content}`,
        ].join('\n');
      case 'change_pov':
        return [
          '【改视角要求】',
          `把选中文字改写成以“${pov}”为叙事视角的版本，只输出替换后的文字。`,
          targetLength,
          `【选中文字】\n${selection}`,
          `【所在正文】\n${content}`,
        ].join('\n');
      case 'hooks':
        return [
          '【钩子要求】',
          '基于正文生成三个不同的章末钩子，每行一个，从 1. 开始编号，只输出三条钩子。',
          `【正文】\n${content}`,
        ].join('\n');
      case 'title':
        return [
          '【标题要求】',
          '为这一章生成一个不含“第几章”的中文标题，只输出标题本身，不超过 20 个汉字。',
          `【正文】\n${content}`,
        ].join('\n');
      case 'summary':
        return [
          '【摘要要求】',
          '用 80 到 160 个汉字概括本章发生的关键事件、人物变化和留下的悬念，只输出摘要。',
          `【正文】\n${content}`,
        ].join('\n');
      case 'chapter':
      default:
        return [
          `请写出这一章的完整正文，目标汉字数：${targetMinCharacters} 到 ${targetMaxCharacters}。`,
          '只统计汉字，标点、空格和换行不计入。',
          '',
          '正文要有清楚的动作、对话和场景推进，结尾落在章末钩子上。',
        ].join('\n');
    }
  }

  private async referenceChapterContext(
    workId: string,
    branchId: string,
    chapterNumbers: number[],
  ): Promise<Array<{ chapterNumber: number; title: string; summary: string; content: string }>> {
    if (chapterNumbers.length === 0) {
      return [];
    }
    const rows = await this.database.db
      .select({
        chapter: chapters,
        version: chapterVersions,
        outline: chapterOutlines,
      })
      .from(chapters)
      .innerJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
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
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
          inArray(chapters.chapterNumber, chapterNumbers),
        ),
      )
      .orderBy(asc(chapters.chapterNumber));

    return rows.map(({ chapter, version, outline }) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      summary: outline?.chapterGoal ?? '',
      content: Array.from(version.content).slice(0, 4_000).join(''),
    }));
  }

  private writingSettings(
    raw: unknown,
    fallback: { targetMinCharacters: number; targetMaxCharacters: number },
  ): WritingSettings {
    const value =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const qualityTier: WritingQualityTier =
      value.qualityTier === 'fast' || value.qualityTier === 'premium'
        ? value.qualityTier
        : 'standard';
    return {
      qualityTier,
      modelConfigId: typeof value.modelConfigId === 'string' ? value.modelConfigId : null,
      targetMinCharacters: this.targetValue(
        value.targetMinCharacters,
        fallback.targetMinCharacters,
      ),
      targetMaxCharacters: this.targetValue(
        value.targetMaxCharacters,
        fallback.targetMaxCharacters,
      ),
      pov: typeof value.pov === 'string' && value.pov.trim() ? value.pov.trim() : null,
      targetPov:
        typeof value.targetPov === 'string' && value.targetPov.trim()
          ? value.targetPov.trim()
          : null,
      mustInclude: this.stringList(value.mustInclude),
      mustAvoid: this.stringList(value.mustAvoid),
      referenceChapters: Array.isArray(value.referenceChapters)
        ? value.referenceChapters.filter(
            (chapter): chapter is number =>
              typeof chapter === 'number' && Number.isInteger(chapter) && chapter > 0,
          )
        : [],
      tabooWords: this.stringList(value.tabooWords),
      cursorOffset: typeof value.cursorOffset === 'number' ? value.cursorOffset : null,
      selectionStart: typeof value.selectionStart === 'number' ? value.selectionStart : null,
      selectionEnd: typeof value.selectionEnd === 'number' ? value.selectionEnd : null,
    };
  }

  private actionValue(raw: unknown): ChapterGenerationAction {
    const actions: ChapterGenerationAction[] = [
      'chapter',
      'continue',
      'rewrite',
      'expand',
      'condense',
      'change_pov',
      'hooks',
      'title',
      'summary',
    ];
    return actions.includes(raw as ChapterGenerationAction)
      ? (raw as ChapterGenerationAction)
      : 'chapter';
  }

  private outputKindValue(
    raw: unknown,
    action: ChapterGenerationAction,
  ): ChapterGenerationOutputKind {
    const kinds: ChapterGenerationOutputKind[] = [
      'chapter',
      'segment',
      'hook_options',
      'title',
      'summary',
    ];
    return kinds.includes(raw as ChapterGenerationOutputKind)
      ? (raw as ChapterGenerationOutputKind)
      : CHAPTER_ACTION_OUTPUT_KIND[action];
  }

  private stringList(raw: unknown): string[] {
    return Array.isArray(raw)
      ? raw
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  }

  private detectTabooIssues(
    content: string,
    tabooWords: string[],
    generation: GenerationRequestRow,
    draftId: string | undefined,
  ) {
    return tabooWords.flatMap((word) => {
      const startOffset = content.indexOf(word);
      if (startOffset < 0) {
        return [];
      }
      return [
        {
          workId: generation.workId,
          branchId: generation.branchId,
          chapterId: generation.chapterId,
          generationRequestId: generation.id,
          draftId,
          factId: null,
          category: 'taboo',
          severity: 'warning',
          message: `正文出现了需要避开的词语“${word}”。`,
          suggestion: `删去“${word}”，或换成不违反作者禁忌的写法。`,
          sourceSentence: word,
          startOffset,
          endOffset: startOffset + word.length,
          status: 'open' as const,
        },
      ];
    });
  }

  private correctionPrompt(
    originalPrompt: string,
    characterCount: number,
    targetMinCharacters: number,
    targetMaxCharacters: number,
  ): string {
    return [
      originalPrompt,
      '',
      '【篇幅校正】',
      `上一版只有 ${characterCount} 个汉字，不在 ${targetMinCharacters} 到 ${targetMaxCharacters} 个汉字的要求内。`,
      `请重写完整正文，目标汉字数：${targetMinCharacters} 到 ${targetMaxCharacters}。`,
      '不要只补一段，也不要解释修改过程，只输出完整章节正文。',
    ].join('\n');
  }

  private targetValue(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
  }

  private async beginStep(
    jobId: string,
    stepKey: GenerationStepKey,
    input: Record<string, unknown>,
    progress: number,
  ): Promise<void> {
    const now = new Date();
    await this.database.db
      .update(jobSteps)
      .set({ status: 'running', input, startedAt: now })
      .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stepKey, stepKey)));
    await this.database.db
      .update(jobs)
      .set({ status: 'running', progress, updatedAt: now })
      .where(eq(jobs.id, jobId));
    await this.appendEvent(jobId, 'job.step.started', { stepKey, progress });
  }

  private async completeStep(
    jobId: string,
    stepKey: GenerationStepKey,
    output: Record<string, unknown>,
    progress: number,
  ): Promise<void> {
    const now = new Date();
    await this.database.db
      .update(jobSteps)
      .set({ status: 'succeeded', output, finishedAt: now })
      .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stepKey, stepKey)));
    await this.database.db.insert(jobCheckpoints).values({
      jobId,
      stepKey,
      state: { output },
    });
    await this.database.db
      .update(jobs)
      .set({
        status: 'running',
        progress,
        checkpoint: { stepKey },
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId));
    await this.appendEvent(jobId, 'job.step.succeeded', { stepKey, progress });
  }

  private async skipStep(
    jobId: string,
    stepKey: GenerationStepKey,
    output: Record<string, unknown>,
  ): Promise<void> {
    await this.database.db
      .update(jobSteps)
      .set({
        status: 'skipped',
        output,
        finishedAt: new Date(),
      })
      .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stepKey, stepKey)));
    await this.appendEvent(jobId, 'job.step.skipped', { stepKey, ...output });
  }

  private async fail(
    jobRow: JobRow,
    generation: GenerationRequestRow,
    draftId: string | undefined,
    error: GenerationErrorInfo,
  ): Promise<{ ok: false }> {
    const failedAt = new Date();
    const activeStep =
      (
        await this.database.db
          .select({ stepKey: jobSteps.stepKey })
          .from(jobSteps)
          .where(and(eq(jobSteps.jobId, jobRow.id), eq(jobSteps.status, 'running')))
          .orderBy(asc(jobSteps.createdAt))
          .limit(1)
      )[0]?.stepKey ?? 'draft';

    await this.database.db
      .update(jobSteps)
      .set({
        status: 'failed',
        error,
        finishedAt: failedAt,
      })
      .where(and(eq(jobSteps.jobId, jobRow.id), eq(jobSteps.stepKey, activeStep)));
    await this.appendEvent(jobRow.id, 'job.step.failed', {
      stepKey: activeStep,
      ...error,
      ...(draftId ? { draftId } : {}),
    });
    await this.appendEvent(jobRow.id, 'job.failed', {
      ...error,
      ...(draftId ? { draftId } : {}),
    });
    await this.database.db
      .update(jobs)
      .set({
        status: 'failed',
        error,
        finishedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(jobs.id, jobRow.id));
    await this.database.db
      .update(generationRequests)
      .set({
        status: 'failed',
        finishedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(generationRequests.id, generation.id));

    return { ok: false };
  }

  private async appendEvent(
    jobId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.database.db.insert(jobEvents).values({
      jobId,
      eventType,
      payload,
    });
  }

  private async requireVisibleJob(jobId: string): Promise<JobRow> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const [job] = await this.database.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (job) {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Generation job ${jobId} was not found`);
  }

  private toErrorInfo(error: unknown): GenerationErrorInfo {
    if (error instanceof AiGatewayError) {
      return {
        code: error.code,
        message: redactModelSecrets(error.message),
        recoverable: true,
      };
    }
    if (error instanceof InvalidGenerationInput) {
      return {
        code: error.code,
        message: error.message,
        recoverable: true,
        ...(error.details ? { details: error.details } : {}),
      };
    }
    if (error instanceof Error && error.message === 'MODEL_CONFIG_REQUIRED') {
      return {
        code: 'MODEL_CONFIG_REQUIRED',
        message: 'Configure a prose model before generating',
        recoverable: true,
      };
    }
    return {
      code: 'MODEL_GENERATION_FAILED',
      message: 'The writing service could not finish this chapter',
      recoverable: true,
    };
  }
}

class InvalidGenerationInput extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
