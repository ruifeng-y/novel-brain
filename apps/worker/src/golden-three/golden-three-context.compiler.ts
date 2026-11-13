import { Injectable } from "@nestjs/common";
import { contextPackPreviewSchema, type ContextPackPreview } from "@novel-brain/contracts";
import {
  compileChapterContextManifest,
  PROVIDER_CALL_MAX_OUTPUT_TOKENS,
  resolveModelContextWindow,
} from "@novel-brain/core";
import type { GoldenThreeContextCompiler, GoldenThreeJobScope } from "@novel-brain/golden-three";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  WorkerGenerationRepository,
  type WorkerJobBase,
} from "../generation/generation.repository";

@Injectable()
export class WorkerGoldenThreeContextCompiler implements GoldenThreeContextCompiler {
  constructor(private readonly generation: WorkerGenerationRepository) {}

  async compile(
    userId: string,
    input: GoldenThreeJobScope,
    tokenBudget: number,
  ): Promise<ContextPackPreview> {
    const payload: WorkerJobBase = {
      jobId: input.jobId,
      workId: input.workId,
      branchId: input.branchId,
      chapterId: input.chapterId,
      actorId: userId,
      modelConfigId: "",
      idempotencyKey: input.jobId,
    };
    const [sources, loaded] = await Promise.all([
      this.generation.loadSources(payload),
      this.generation.loadJob(payload),
    ]);
    if (!sources || !loaded) {
      throw new Error("Golden three context sources are incomplete");
    }
    const pack = compileChapterContextManifest(
      {
        branchId: payload.branchId,
        branchStatus: sources.branch.status,
        compilerVersion: "m1-context-v1",
        chapter: {
          id: sources.chapter.id,
          number: sources.chapter.number,
          title: sources.chapter.title,
          brief: sources.chapter.brief,
        },
        storyBible: {
          id: sources.storyBible.id,
          cards: sources.storyBible.cards,
          worldRules: sources.worldRules,
        },
        ...(sources.styleSample ? { styleSample: sources.styleSample } : {}),
        styleSampleId: sources.chapter.workId,
        settings: sources.settings.map((setting) => ({
          id: setting.id,
          type: setting.type,
          name: setting.name,
          aliases: setting.aliases,
          summary: setting.summary,
          description: setting.description,
          tags: setting.tags,
          attributes: setting.attributes,
          ...(setting.sourceChapterNumber
            ? { sourceChapterNumber: setting.sourceChapterNumber }
            : {}),
          ...(setting.validFromChapter ? { validFromChapter: setting.validFromChapter } : {}),
          validToChapter: setting.validToChapter ?? null,
        })),
        previousVersions: sources.previousVersions,
        summaries: sources.summaries,
        povCharacterId: sources.povCharacterId ?? null,
        modelContextWindowTokens: resolveModelContextWindow(loaded.modelConfig.model),
        reservedOutputTokens: PROVIDER_CALL_MAX_OUTPUT_TOKENS,
        ...(sources.knowledge ? { knowledge: sources.knowledge } : {}),
      },
      tokenBudget,
    );
    return contextPackPreviewSchema.parse(pack);
  }
}
