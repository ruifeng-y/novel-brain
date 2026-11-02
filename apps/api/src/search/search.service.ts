import { HttpStatus, Injectable } from '@nestjs/common';
import {
  WORK_SEARCH_TYPE_LABELS,
  type WorkSearchInput,
  type WorkSearchItem,
  type WorkSearchResult,
} from '@novel/contracts';
import { chapterOutlines, chapters, chapterVersions, entities, workBranches, works } from '@novel/db';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { searchError } from './search.errors';

@Injectable()
export class SearchService {
  constructor(private readonly database: DatabaseService) {}

  async search(
    userId: string,
    workId: string,
    branchId: string,
    input: WorkSearchInput,
  ): Promise<WorkSearchResult> {
    await this.requireBranch(userId, workId, branchId);
    const pattern = `%${input.q}%`;
    const perTypeLimit = Math.min(input.limit, 20);

    const [settingRows, outlineRows, chapterRows] = await Promise.all([
      this.database.db
        .select({
          id: entities.id,
          name: entities.name,
          aliases: entities.aliases,
          summary: entities.summary,
          description: entities.description,
          tags: entities.tags,
          customFields: entities.customFields,
          updatedAt: entities.updatedAt,
        })
        .from(entities)
        .where(
          and(
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            isNull(entities.deletedAt),
            or(
              ilike(entities.name, pattern),
              ilike(entities.summary, pattern),
              ilike(entities.description, pattern),
              sql`${entities.aliases}::text ilike ${pattern}`,
              sql`${entities.tags}::text ilike ${pattern}`,
              sql`${entities.customFields}::text ilike ${pattern}`,
            ),
          ),
        )
        .orderBy(desc(entities.updatedAt), entities.name)
        .limit(perTypeLimit),
      this.database.db
        .select({
          id: chapterOutlines.id,
          level: chapterOutlines.level,
          title: chapterOutlines.title,
          summary: chapterOutlines.summary,
          details: chapterOutlines.details,
          chapterNumber: chapterOutlines.chapterNumber,
          chapterGoal: chapterOutlines.chapterGoal,
          pov: chapterOutlines.pov,
          sceneBeats: chapterOutlines.sceneBeats,
          chapterEndHook: chapterOutlines.chapterEndHook,
          updatedAt: chapterOutlines.updatedAt,
        })
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.workId, workId),
            eq(chapterOutlines.branchId, branchId),
            or(
              ilike(chapterOutlines.title, pattern),
              ilike(chapterOutlines.summary, pattern),
              ilike(chapterOutlines.details, pattern),
              ilike(chapterOutlines.chapterGoal, pattern),
              ilike(chapterOutlines.pov, pattern),
              ilike(chapterOutlines.chapterEndHook, pattern),
              sql`${chapterOutlines.sceneBeats}::text ilike ${pattern}`,
            ),
          ),
        )
        .orderBy(chapterOutlines.chapterNumber, chapterOutlines.orderIndex)
        .limit(perTypeLimit),
      this.database.db
        .select({
          id: chapters.id,
          chapterNumber: chapters.chapterNumber,
          title: chapters.title,
          summary: chapters.summary,
          hook: chapters.hook,
          autosaveContent: chapters.autosaveContent,
          versionContent: chapterVersions.content,
          updatedAt: chapters.updatedAt,
        })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(
          and(
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
            or(
              ilike(chapters.title, pattern),
              ilike(chapters.summary, pattern),
              ilike(chapters.hook, pattern),
              ilike(chapters.autosaveContent, pattern),
              ilike(chapterVersions.content, pattern),
            ),
          ),
        )
        .orderBy(chapters.chapterNumber)
        .limit(perTypeLimit),
    ]);

    const items: WorkSearchItem[] = [
      ...settingRows.map((row) =>
        this.item('setting', row.id, row.name, this.snippet(input.q, [
          row.name,
          row.summary,
          row.description,
          row.aliases.join(' '),
          row.tags.join(' '),
          JSON.stringify(row.customFields),
        ]), null, row.updatedAt),
      ),
      ...outlineRows.map((row) =>
        this.item(
          'outline',
          row.id,
          this.chapterLabel(row.chapterNumber, row.title, '大纲'),
          this.snippet(input.q, [
            row.title,
            row.summary,
            row.details,
            row.chapterGoal,
            row.pov,
            row.sceneBeats.join(' '),
            row.chapterEndHook,
          ]),
          row.chapterNumber,
          row.updatedAt,
        ),
      ),
      ...chapterRows.map((row) =>
        this.item(
          'chapter',
          row.id,
          this.chapterLabel(row.chapterNumber, row.title, '未命名章节'),
          this.snippet(input.q, [
            row.title,
            row.summary,
            row.hook,
            row.autosaveContent,
            row.versionContent ?? '',
          ]),
          row.chapterNumber,
          row.updatedAt,
        ),
      ),
    ];

    const order = { setting: 0, outline: 1, chapter: 2 } as const;
    items.sort(
      (left, right) =>
        order[left.type] - order[right.type] ||
        (left.chapterNumber ?? 0) - (right.chapterNumber ?? 0),
    );

    return { query: input.q, items: items.slice(0, input.limit) };
  }

  private item(
    type: WorkSearchItem['type'],
    id: string,
    title: string,
    snippet: string,
    chapterNumber: number | null,
    updatedAt: Date,
  ): WorkSearchItem {
    return {
      type,
      typeLabel: WORK_SEARCH_TYPE_LABELS[type],
      id,
      title,
      snippet,
      chapterNumber,
      updatedAt: updatedAt.toISOString(),
    };
  }

  private snippet(query: string, values: string[]): string {
    const normalizedQuery = query.toLocaleLowerCase('zh-CN');
    for (const value of values) {
      if (!value) {
        continue;
      }
      const normalized = value.toLocaleLowerCase('zh-CN');
      const index = normalized.indexOf(normalizedQuery);
      if (index < 0) {
        continue;
      }
      const start = Math.max(0, index - 24);
      const end = Math.min(value.length, index + query.length + 48);
      return `${start > 0 ? '…' : ''}${value.slice(start, end).replace(/\s+/g, ' ').trim()}${
        end < value.length ? '…' : ''
      }`;
    }

    const fallback = values.find((value) => value.trim().length > 0)?.trim() ?? '';
    return fallback.length > 80 ? `${fallback.slice(0, 80)}…` : fallback;
  }

  private chapterLabel(chapterNumber: number | null, title: string, fallback: string): string {
    const trimmed = title.trim();
    if (chapterNumber === null) {
      return trimmed || fallback;
    }
    const chapterPrefix = `第 ${chapterNumber} 章`;
    if (!trimmed) {
      return `${chapterPrefix} · ${fallback}`;
    }
    return trimmed.startsWith(chapterPrefix) ? trimmed : `${chapterPrefix} · ${trimmed}`;
  }

  private async requireBranch(userId: string, workId: string, branchId: string): Promise<void> {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw searchError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw searchError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
  }
}
