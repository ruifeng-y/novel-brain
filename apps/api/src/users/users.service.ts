import { HttpStatus, Injectable } from '@nestjs/common';
import {
  chapterOutlines,
  chapterVersions,
  chapters,
  modelConfigs,
  storyBibles,
  users,
  workBranches,
  works,
} from '@novel/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../security/rate-limit.service';
import { usersError } from './users.errors';

const EXPORT_LIMIT = 3;
const EXPORT_WINDOW_SECONDS = 60 * 60;

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: RateLimitService,
  ) {}

  async exportAccount(userId: string) {
    if (!(await this.rateLimits.consume('export', userId, EXPORT_LIMIT, EXPORT_WINDOW_SECONDS))) {
      throw usersError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '导出过于频繁，请稍后再试',
      );
    }

    const [account] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account) {
      throw usersError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', '请先登录');
    }

    const workRows = await this.database.db
      .select()
      .from(works)
      .where(eq(works.userId, userId))
      .orderBy(asc(works.createdAt));
    const workIds = workRows.map((work) => work.id);

    const branchRows =
      workIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(workBranches)
            .where(inArray(workBranches.workId, workIds))
            .orderBy(asc(workBranches.createdAt));
    const bibleRows =
      workIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(storyBibles)
            .where(inArray(storyBibles.workId, workIds))
            .orderBy(asc(storyBibles.createdAt));
    const outlineRows =
      workIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(chapterOutlines)
            .where(inArray(chapterOutlines.workId, workIds))
            .orderBy(asc(chapterOutlines.chapterNumber));
    const chapterRows =
      workIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(chapters)
            .where(inArray(chapters.workId, workIds))
            .orderBy(asc(chapters.chapterNumber));
    const modelRows = await this.database.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.userId, userId))
      .orderBy(asc(modelConfigs.createdAt));

    const chapterIds = chapterRows.map((chapter) => chapter.id);
    const versionRows =
      chapterIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(chapterVersions)
            .where(inArray(chapterVersions.chapterId, chapterIds))
            .orderBy(asc(chapterVersions.version));

    return {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        createdAt: account.createdAt.toISOString(),
      },
      works: workRows,
      branches: branchRows,
      storyBibles: bibleRows,
      chapterOutlines: outlineRows,
      chapters: chapterRows,
      chapterVersions: versionRows,
      modelConfigs: modelRows.map((row) => ({
        id: row.id,
        name: row.name,
        provider: row.provider,
        baseUrl: row.baseUrl,
        model: row.model,
        purpose: row.purpose,
        isDefault: row.isDefault,
      })),
    };
  }
}
