import { Inject, Injectable } from '@nestjs/common';
import {
  AI_GATEWAY,
  AiGatewayError,
  type AiGateway,
} from '@novel/ai';
import {
  chapterOutlines,
  contextPacks,
  drafts,
  generationRequests,
  jobCheckpoints,
  jobEvents,
  jobSteps,
  jobs,
  storyBibles,
  type ChapterOutlineRow,
  type GenerationRequestRow,
  type JobRow,
  type StoryBibleRow,
} from '@novel/db';
import { and, asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { GenerationModelConfigResolver } from './generation-model-config.resolver';

type GenerationStepKey = 'readiness' | 'brief' | 'context' | 'draft';

type GenerationErrorInfo = {
  code: string;
  message: string;
  recoverable: true;
};

type ContextSection = {
  key: string;
  title: string;
  content: Record<string, unknown>;
};

@Injectable()
export class ChapterGenerationRunner {
  constructor(
    private readonly database: DatabaseService,
    private readonly modelResolver: GenerationModelConfigResolver,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
  ) {}

  async run(jobId: string): Promise<{ ok: boolean }> {
    const [jobRow] = await this.database.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    if (!jobRow) {
      throw new Error(`Generation job ${jobId} was not found`);
    }
    if (jobRow.status === 'completed' || jobRow.status === 'failed') {
      return { ok: jobRow.status === 'completed' };
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

    let draftId: string | undefined;
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

      await this.beginStep(jobId, 'readiness', { outlineId: outline.id }, 10);
      if (!bible) {
        throw new InvalidGenerationInput(
          'STORY_BIBLE_REQUIRED',
          'Save the story bible before generating a chapter',
        );
      }
      const model = await this.modelResolver.resolve(generation.createdBy);
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

      await this.beginStep(jobId, 'brief', { outlineId: outline.id }, 20);
      const brief = {
        goal: outline.chapterGoal,
        pov: outline.pov,
        sceneBeats: outline.sceneBeats,
        chapterEndHook: outline.chapterEndHook,
      };
      await this.completeStep(jobId, 'brief', brief, 30);

      await this.beginStep(jobId, 'context', { outlineId: outline.id }, 35);
      const context = this.compileContext(bible, outline, generation);
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

      let content = '';
      let chunkCount = 0;
      for await (const chunk of this.gateway.streamText({
        system: context.systemPrompt,
        prompt: context.userPrompt,
        model: model.model,
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        maxTokens: 4_000,
        temperature: 0.75,
      })) {
        if (!chunk.text) {
          continue;
        }
        content += chunk.text;
        chunkCount += 1;
        await this.database.db
          .update(drafts)
          .set({ content, updatedAt: new Date() })
          .where(eq(drafts.id, draftId));
        await this.appendEvent(jobId, 'job.draft.delta', {
          delta: chunk.text,
          contentLength: content.length,
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

      if (!content.trim()) {
        throw new InvalidGenerationInput(
          'EMPTY_GENERATION',
          'The model did not return any chapter text',
        );
      }

      await this.database.db
        .update(drafts)
        .set({ content, status: 'ready', updatedAt: new Date() })
        .where(eq(drafts.id, draftId));
      await this.completeStep(
        jobId,
        'draft',
        {
          draftId,
          wordCount: content.length,
        },
        98,
      );

      const completedAt = new Date();
      await this.appendEvent(jobId, 'job.completed', {
        draftId,
        wordCount: content.length,
        progress: 100,
      });
      await this.database.db
        .update(jobs)
        .set({
          status: 'completed',
          progress: 100,
          checkpoint: { stepKey: 'draft' },
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

      return { ok: true };
    } catch (error) {
      const errorInfo = this.toErrorInfo(error);
      if (draftId) {
        await this.database.db
          .update(drafts)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(drafts.id, draftId));
      }
      await this.fail(jobRow, generation, draftId, errorInfo);
      return { ok: false };
    }
  }

  private compileContext(
    bible: StoryBibleRow,
    outline: ChapterOutlineRow,
    generation: GenerationRequestRow,
  ): {
    sections: ContextSection[];
    sourceRefs: string[];
    systemPrompt: string;
    userPrompt: string;
  } {
    const sections: ContextSection[] = [
      {
        key: 'storyBible',
        title: '故事圣经',
        content: {
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
      {
        key: 'writingGuidance',
        title: '写作要求',
        content: {
          targetCharacters: '2000 到 3000 个中文字符',
          instruction: generation.instruction ?? '',
          output: '只输出章节正文，不解释创作过程。',
        },
      },
    ];

    const systemPrompt = [
      '你是一位擅长中文长篇网络小说的作者。',
      '请严格依据作者提供的创作资料写作，保持人物、世界规则和前文事实一致。',
      '只输出可以直接进入编辑器的章节正文，不要标题、说明、Markdown 代码块或创作分析。',
    ].join('\n');
    const userPrompt = [
      '请写出这一章的完整正文，长度控制在 2000 到 3000 个中文字符之间。',
      '',
      '【故事圣经】',
      `一句话故事：${bible.oneSentenceStory}`,
      `主角：${bible.protagonist}`,
      `世界铁律：${bible.worldIronLaw}`,
      '',
      '【本章章纲】',
      `章目标：${outline.chapterGoal}`,
      `叙事视角：${outline.pov}`,
      `场景节拍：${outline.sceneBeats.join('；')}`,
      `章末钩子：${outline.chapterEndHook}`,
      ...(generation.instruction
        ? ['', '【作者补充要求】', generation.instruction]
        : []),
      '',
      '正文要有清楚的动作、对话和场景推进，结尾落在章末钩子上。',
    ].join('\n');

    return {
      sections,
      sourceRefs: [`story_bible:${bible.id}`, `chapter_outline:${outline.id}`],
      systemPrompt,
      userPrompt,
    };
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

  private toErrorInfo(error: unknown): GenerationErrorInfo {
    if (error instanceof AiGatewayError) {
      return {
        code: error.code,
        message: error.message,
        recoverable: true,
      };
    }
    if (error instanceof InvalidGenerationInput) {
      return {
        code: error.code,
        message: error.message,
        recoverable: true,
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
  ) {
    super(message);
  }
}
