import { HttpStatus, Injectable } from '@nestjs/common';
import {
  getGenrePackDefinition,
  HISTORY_MAIN_TEMPLATE,
  HISTORY_VARIANT_LABELS,
  WORK_STATUS_LABELS,
  type CreateWorkInput,
  type GenrePackDefinition,
  type HistoryVariant,
} from '@novel/contracts';
import { workBranches, works, type WorkBranchRow, type WorkRow } from '@novel/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { worksError } from './works.errors';

type WorkResponse = {
  id: string;
  title: string;
  penName: string;
  genrePack: string;
  genrePackLabel: string;
  genreTemplate: GenrePackDefinition['template'] & {
    subtypes: GenrePackDefinition['subtypes'];
  };
  genreVariant: string | null;
  genreVariantLabel: string | null;
  mainTemplate: string | null;
  scale: string;
  targetPlatform: string;
  status: WorkRow['status'];
  statusLabel: string;
  wordCount: number;
  progressPercent: number;
  lastEditedAt: string;
  createdAt: string;
  mainBranch: {
    id: string;
    name: string;
    isMain: boolean;
  } | null;
};

@Injectable()
export class WorksService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string): Promise<{ items: WorkResponse[] }> {
    const workRows = await this.database.db
      .select()
      .from(works)
      .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
      .orderBy(desc(works.updatedAt));

    if (workRows.length === 0) {
      return { items: [] };
    }

    const branchRows = await this.database.db
      .select()
      .from(workBranches)
      .where(
        and(
          inArray(
            workBranches.workId,
            workRows.map((work) => work.id),
          ),
          eq(workBranches.isMain, true),
        ),
      );
    const branchesByWorkId = new Map(branchRows.map((branch) => [branch.workId, branch]));

    return {
      items: workRows.map((work) => this.toResponse(work, branchesByWorkId.get(work.id) ?? null)),
    };
  }

  async create(userId: string, input: CreateWorkInput): Promise<WorkResponse> {
    const created = await this.database.db.transaction(async (tx) => {
      const [work] = await tx
        .insert(works)
        .values({
          userId,
          title: input.title,
          penName: input.penName,
          genrePack: input.genrePack,
          genreVariant:
            input.genrePack === 'history'
              ? (input.genreVariant ?? 'alternate_ancient')
              : null,
          scale: input.scale,
          targetPlatform: input.targetPlatform,
          status: 'preparing',
        })
        .returning();

      const [mainBranch] = await tx
        .insert(workBranches)
        .values({
          workId: work.id,
          name: 'main',
          isMain: true,
          status: 'active',
          createdBy: userId,
        })
        .returning();

      return { work, mainBranch };
    });

    return this.toResponse(created.work, created.mainBranch);
  }

  async get(userId: string, workId: string): Promise<WorkResponse> {
    const [work] = await this.database.db
      .select()
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);

    if (!work) {
      throw worksError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    const [mainBranch] = await this.database.db
      .select()
      .from(workBranches)
      .where(and(eq(workBranches.workId, work.id), eq(workBranches.isMain, true)))
      .limit(1);

    return this.toResponse(work, mainBranch ?? null);
  }

  private toResponse(work: WorkRow, mainBranch: WorkBranchRow | null): WorkResponse {
    const genrePack = getGenrePackDefinition(work.genrePack);
    const historyVariant =
      work.genrePack === 'history'
        ? ((work.genreVariant ?? 'alternate_ancient') as HistoryVariant)
        : null;
    return {
      id: work.id,
      title: work.title,
      penName: work.penName,
      genrePack: work.genrePack,
      genrePackLabel: genrePack?.label ?? work.genrePack,
      genreTemplate: {
        key: genrePack?.template.key ?? work.genrePack,
        name: genrePack?.template.name ?? '题材主模板',
        summary: genrePack?.template.summary ?? '',
        writingGuide: genrePack?.template.writingGuide ?? [],
        checkCategories: genrePack?.template.checkCategories ?? [],
        subtypes: genrePack?.subtypes ?? [],
      },
      genreVariant: historyVariant,
      genreVariantLabel: historyVariant ? HISTORY_VARIANT_LABELS[historyVariant] : null,
      mainTemplate: work.genrePack === 'history' ? HISTORY_MAIN_TEMPLATE : null,
      scale: work.scale,
      targetPlatform: work.targetPlatform,
      status: work.status,
      statusLabel: WORK_STATUS_LABELS[work.status],
      wordCount: 0,
      progressPercent: 0,
      lastEditedAt: work.updatedAt.toISOString(),
      createdAt: work.createdAt.toISOString(),
      mainBranch: mainBranch
        ? {
            id: mainBranch.id,
            name: mainBranch.name,
            isMain: mainBranch.isMain,
          }
        : null,
    };
  }
}
