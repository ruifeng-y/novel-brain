import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AI_GATEWAY, AiGatewayError, type AiGateway } from '@novel/ai';
import {
  GENRE_PACK_LABELS,
  publishSuggestionsSchema,
  type PublishCheckResponse,
  type PublishReaderPreview,
  type PublishSuggestions,
  type WorkGenrePack,
} from '@novel/contracts';
import {
  chapterOutlines,
  chapterVersions,
  chapters,
  storyBibles,
  workBranches,
  works,
} from '@novel/db';
import { evaluatePublishCheck, renderPublishCheckReport } from '@novel/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { ModelConfigService } from '../ai/model-config.service';
import { DatabaseService } from '../database/database.service';
import { publishError } from './publish.errors';

const PUBLISH_SUGGESTIONS_JSON_SCHEMA = {
  type: 'object',
  required: ['titles', 'synopsis', 'tags', 'chapterTitles'],
  properties: {
    titles: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: { type: 'string' },
    },
    synopsis: { type: 'string' },
    tags: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: { type: 'string' },
    },
    chapterTitles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['chapterNumber', 'title'],
        properties: {
          chapterNumber: { type: 'integer' },
          title: { type: 'string' },
        },
      },
    },
  },
};

type PublishSource = Awaited<ReturnType<PublishService['loadSource']>>;

@Injectable()
export class PublishService {
  constructor(
    private readonly database: DatabaseService,
    private readonly modelConfigs: ModelConfigService,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
  ) {}

  async suggestions(userId: string, workId: string, branchId: string): Promise<PublishSuggestions> {
    const source = await this.loadSource(userId, workId, branchId);
    const credentials = await this.modelConfigs.purposeCredentials(userId, 'planning');
    if (!credentials) {
      throw publishError(
        HttpStatus.CONFLICT,
        'MODEL_CONFIG_REQUIRED',
        '还没有可用的规划模型，请先到模型设置里完成配置。',
      );
    }

    try {
      const result = await this.gateway.generateObject({
        prompt: this.suggestionPrompt(source),
        system: '你是中文长篇小说发布编辑，只输出符合给定结构的 JSON。',
        model: credentials.model,
        apiKey: credentials.apiKey,
        baseUrl: credentials.baseUrl,
        schemaName: 'publish_suggestions',
        schemaDescription: '书名、简介、标签和前三章章节名建议',
        jsonSchema: PUBLISH_SUGGESTIONS_JSON_SCHEMA,
        parse: (value) => publishSuggestionsSchema.parse(value),
      });
      return this.normalizeSuggestions(result.object, source);
    } catch (error) {
      if (error instanceof AiGatewayError) {
        throw publishError(
          HttpStatus.BAD_GATEWAY,
          'PUBLISH_SUGGESTIONS_FAILED',
          '发布建议暂时生成失败，请稍后重试。',
        );
      }
      throw error;
    }
  }

  async preview(userId: string, workId: string, branchId: string): Promise<PublishReaderPreview> {
    const source = await this.loadSource(userId, workId, branchId);
    const genreLabel =
      GENRE_PACK_LABELS[source.work.genrePack as WorkGenrePack] ?? source.work.genrePack;
    return {
      title: source.work.title,
      penName: source.work.penName,
      genreLabel,
      synopsis: source.work.synopsis || source.bible?.oneSentenceStory || '还没有填写作品简介。',
      tags: [...new Set([genreLabel, ...source.work.tags])].slice(0, 10),
      coverUrl: source.work.coverStorageKey
        ? `/api/v1/works/${source.work.id}/cover/content?v=${(
            source.work.coverUpdatedAt ?? source.work.updatedAt
          ).getTime()}`
        : null,
      chapters: source.chapters
        .filter((chapter) => chapter.content.trim().length > 0)
        .slice(0, 3)
        .map((chapter) => ({
          chapterNumber: chapter.chapterNumber,
          title: chapter.title,
          content: chapter.content,
        })),
      exportOnly: true,
    };
  }

  async check(
    userId: string,
    workId: string,
    branchId: string,
    format: string,
  ): Promise<PublishCheckResponse> {
    const source = await this.loadSource(userId, workId, branchId);
    const result = evaluatePublishCheck({
      format,
      chapters: source.chapters,
    });
    const generatedAt = new Date().toISOString();
    return {
      ...result,
      generatedAt,
      report: renderPublishCheckReport({
        title: source.work.title,
        generatedAt,
        result,
      }),
    };
  }

  private async loadSource(userId: string, workId: string, branchId: string) {
    const [work] = await this.database.db
      .select({
        id: works.id,
        title: works.title,
        penName: works.penName,
        genrePack: works.genrePack,
        genreVariant: works.genreVariant,
        synopsis: works.synopsis,
        tags: works.tags,
        coverStorageKey: works.coverStorageKey,
        coverUpdatedAt: works.coverUpdatedAt,
        updatedAt: works.updatedAt,
      })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw publishError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', '没有找到这部作品。');
    }

    const [branch] = await this.database.db
      .select({ id: workBranches.id, name: workBranches.name })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw publishError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', '没有找到这条创作线。');
    }

    const [outlineRows, chapterRows, bibleRows] = await Promise.all([
      this.database.db
        .select({
          chapterNumber: chapterOutlines.chapterNumber,
          title: chapterOutlines.title,
          hook: chapterOutlines.chapterEndHook,
        })
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branchId),
            eq(chapterOutlines.level, 'chapter'),
          ),
        )
        .orderBy(asc(chapterOutlines.orderIndex), asc(chapterOutlines.createdAt)),
      this.database.db
        .select({
          chapterNumber: chapters.chapterNumber,
          title: chapters.title,
          hook: chapters.hook,
          autosaveContent: chapters.autosaveContent,
          versionContent: chapterVersions.content,
          versionSource: chapterVersions.source,
        })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(and(eq(chapters.workId, workId), eq(chapters.branchId, branchId)))
        .orderBy(asc(chapters.chapterNumber)),
      this.database.db
        .select({
          oneSentenceStory: storyBibles.oneSentenceStory,
          protagonist: storyBibles.protagonist,
          worldIronLaw: storyBibles.worldIronLaw,
          cards: storyBibles.cards,
        })
        .from(storyBibles)
        .where(and(eq(storyBibles.workId, workId), eq(storyBibles.branchId, branchId)))
        .limit(1),
    ]);

    const outlineByChapter = new Map(
      outlineRows
        .filter((outline) => outline.chapterNumber !== null)
        .map((outline) => [outline.chapterNumber as number, outline]),
    );
    const chapterByNumber = new Map(chapterRows.map((chapter) => [chapter.chapterNumber, chapter]));
    const chapterNumbers = [
      ...new Set([
        ...chapterRows.map((chapter) => chapter.chapterNumber),
        ...outlineRows
          .map((outline) => outline.chapterNumber)
          .filter((chapterNumber): chapterNumber is number => chapterNumber !== null),
      ]),
    ].sort((left, right) => left - right);

    return {
      work,
      branch,
      bible: bibleRows[0] ?? null,
      chapters: chapterNumbers.map((chapterNumber) => {
        const chapter = chapterByNumber.get(chapterNumber);
        const outline = outlineByChapter.get(chapterNumber);
        return {
          chapterNumber,
          title: chapter?.title ?? outline?.title ?? `第 ${chapterNumber} 章`,
          hook: chapter?.hook.trim() || outline?.hook.trim() || '',
          content: chapter?.versionContent ?? chapter?.autosaveContent ?? '',
          aiGenerated: chapter?.versionSource === 'generated',
        };
      }),
    };
  }

  private suggestionPrompt(source: PublishSource): string {
    const bible = source.bible;
    const firstThree = source.chapters.slice(0, 3);
    return [
      '【书名要求】给出 3 个不重复、适合中文网文平台的书名，保留核心冲突。',
      '【简介要求】写一段 120 到 220 字、不剧透结局的作品简介。',
      '【标签要求】给出 3 到 6 个能帮助读者判断题材和爽点的标签。',
      '【章节命名要求】只为前三章各给一个更利落的章节名，保留章节号。',
      `当前书名：${source.work.title}`,
      `笔名：${source.work.penName}`,
      `题材：${GENRE_PACK_LABELS[source.work.genrePack as WorkGenrePack] ?? source.work.genrePack}`,
      `一句话故事：${bible?.oneSentenceStory ?? '暂无'}`,
      `主角：${bible?.protagonist ?? '暂无'}`,
      `世界铁律：${bible?.worldIronLaw ?? '暂无'}`,
      '前三章：',
      ...firstThree.map(
        (chapter) =>
          `第 ${chapter.chapterNumber} 章《${chapter.title}》钩子：${chapter.hook || '暂无'}；正文开头：${chapter.content.slice(0, 240)}`,
      ),
    ].join('\n');
  }

  private normalizeSuggestions(
    suggestions: PublishSuggestions,
    source: PublishSource,
  ): PublishSuggestions {
    const chapterNumbers = new Set(
      source.chapters.slice(0, 3).map((chapter) => chapter.chapterNumber),
    );
    return {
      ...suggestions,
      titles: [...new Set(suggestions.titles.map((title) => title.trim()))].slice(0, 5),
      tags: [...new Set(suggestions.tags.map((tag) => tag.trim()))].slice(0, 10),
      chapterTitles: suggestions.chapterTitles
        .filter((chapter) => chapterNumbers.has(chapter.chapterNumber))
        .slice(0, 3),
    };
  }
}
