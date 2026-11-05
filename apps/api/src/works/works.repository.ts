import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  entities,
  entityVersions,
  genrePacks,
  modelConfigs,
  storyBibles,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import type { ImportCandidateType, WorkListQuery } from "@novel-brain/contracts";
import { and, desc, eq, gt, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type WorkRecord = InferSelectModel<typeof works>;
export type WorkBranchRecord = InferSelectModel<typeof workBranches>;
export type GenrePackRecord = InferSelectModel<typeof genrePacks>;
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

export interface WorksAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface InitialSettingEntity {
  type: ImportCandidateType;
  name: string;
  summary: string;
  description: string;
  tags: string[];
  attributes: Record<string, unknown>;
  importCandidateId: string;
}

@Injectable()
export class WorksRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }

  async list(
    userId: string,
    query: WorkListQuery,
  ): Promise<{ works: WorkRecord[]; nextCursor: string | null }> {
    return this.withTenant(userId, async (transaction) => {
      const conditions: SQL[] = [eq(works.userId, userId), isNull(works.deletedAt)];
      if (query.status) {
        conditions.push(eq(works.status, query.status));
      }
      if (query.genre) {
        conditions.push(eq(works.genre, query.genre));
      }
      if (query.q) {
        const search = `%${query.q}%`;
        conditions.push(or(ilike(works.title, search), ilike(works.penName, search))!);
      }
      if (query.cursor) {
        conditions.push(lt(works.id, query.cursor));
      }

      const records = await transaction
        .select()
        .from(works)
        .where(and(...conditions))
        .orderBy(desc(works.id))
        .limit(query.limit + 1);
      const hasMore = records.length > query.limit;
      const page = hasMore ? records.slice(0, query.limit) : records;
      return {
        works: page,
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  async find(userId: string, workId: string): Promise<WorkRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [work] = await transaction
        .select()
        .from(works)
        .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
        .limit(1);
      return work;
    });
  }

  async findBranches(userId: string, workId: string): Promise<WorkBranchRecord[]> {
    return this.withTenant(userId, (transaction) =>
      transaction
        .select()
        .from(workBranches)
        .where(and(eq(workBranches.userId, userId), eq(workBranches.workId, workId)))
        .orderBy(desc(workBranches.createdAt)),
    );
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<WorkRecord | undefined> {
    const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
    return this.withTenant(userId, async (transaction) => {
      const [work] = await transaction
        .select()
        .from(works)
        .where(
          and(
            eq(works.userId, userId),
            eq(works.idempotencyKey, idempotencyKey),
            gt(works.createdAt, cutoff),
          ),
        )
        .limit(1);
      return work;
    });
  }

  async hasModelConfig(userId: string): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      const [config] = await transaction
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(and(eq(modelConfigs.userId, userId), isNull(modelConfigs.deletedAt)))
        .limit(1);
      return Boolean(config);
    });
  }

  async isStoryBibleLocked(userId: string, workId: string, branchId: string): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      const [storyBible] = await transaction
        .select({ id: storyBibles.id })
        .from(storyBibles)
        .where(
          and(
            eq(storyBibles.userId, userId),
            eq(storyBibles.workId, workId),
            eq(storyBibles.branchId, branchId),
            eq(storyBibles.status, "locked"),
          ),
        )
        .limit(1);
      return Boolean(storyBible);
    });
  }

  async hasReadyChapterBrief(userId: string, workId: string, branchId: string): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      const [chapter] = await transaction
        .select({ id: chapters.id })
        .from(chapters)
        .where(
          and(
            eq(chapters.userId, userId),
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
            sql`coalesce(${chapters.brief}->>'goal', '') <> ''`,
            sql`coalesce(${chapters.brief}->>'pov', '') <> ''`,
            sql`coalesce(${chapters.brief}->>'location', '') <> ''`,
            sql`jsonb_typeof(${chapters.brief}->'sceneBeats') = 'array'`,
            sql`jsonb_array_length(${chapters.brief}->'sceneBeats') > 0`,
            sql`jsonb_typeof(${chapters.brief}->'requiredFacts') = 'array'`,
            sql`jsonb_array_length(${chapters.brief}->'requiredFacts') > 0`,
          ),
        )
        .limit(1);
      return Boolean(chapter);
    });
  }

  async findGenrePackByKey(key: string, version = 1): Promise<GenrePackRecord | undefined> {
    const [pack] = await this.db
      .select()
      .from(genrePacks)
      .where(and(eq(genrePacks.key, key), eq(genrePacks.version, version)))
      .limit(1);
    return pack;
  }

  async findGenrePacksByIds(ids: string[]): Promise<GenrePackRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.db.select().from(genrePacks).where(inArray(genrePacks.id, ids));
  }

  async create(input: {
    id: string;
    branchId: string;
    nodeId: string;
    userId: string;
    title: string;
    penName: string;
    genre: string;
    scaleTarget: string;
    chapterLengthTarget: number;
    sourceMode: string;
    idea: string | null;
    templatePackId: string | null;
    settings: Record<string, unknown>;
    initialSettingEntities?: InitialSettingEntity[];
    idempotencyKey: string | null;
    audit: WorksAuditContext;
  }): Promise<{ work: WorkRecord; branch: WorkBranchRecord }> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${input.userId}, true)`);
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
      if (input.idempotencyKey) {
        const [existing] = await transaction
          .select()
          .from(works)
          .where(
            and(eq(works.userId, input.userId), eq(works.idempotencyKey, input.idempotencyKey)),
          )
          .limit(1);
        if (existing) {
          if (existing.createdAt.getTime() >= Date.now() - IDEMPOTENCY_TTL_MS) {
            const [branch] = await transaction
              .select()
              .from(workBranches)
              .where(
                and(
                  eq(workBranches.workId, existing.id),
                  eq(workBranches.userId, input.userId),
                  eq(workBranches.name, "main"),
                ),
              )
              .limit(1);
            if (!branch) {
              throw new Error("Existing work is missing its main branch");
            }
            return { work: existing, branch };
          }
          await transaction
            .update(works)
            .set({ idempotencyKey: null })
            .where(eq(works.id, existing.id));
        }
      }

      const [work] = await transaction
        .insert(works)
        .values({
          id: input.id,
          userId: input.userId,
          title: input.title,
          penName: input.penName,
          genre: input.genre,
          status: "draft",
          scaleTarget: input.scaleTarget,
          chapterLengthTarget: input.chapterLengthTarget,
          sourceMode: input.sourceMode,
          idea: input.idea,
          templatePackId: input.templatePackId,
          settings: input.settings,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      if (!work) {
        throw new Error("Failed to create work");
      }

      const [branch] = await transaction
        .insert(workBranches)
        .values({
          id: input.branchId,
          workId: work.id,
          userId: input.userId,
          name: "main",
          status: "active",
        })
        .returning();
      if (!branch) {
        throw new Error("Failed to create main branch");
      }

      await transaction.insert(versionNodes).values({
        id: input.nodeId,
        workId: work.id,
        branchId: branch.id,
        userId: input.userId,
        nodeType: "snapshot",
        objectType: "work",
        objectId: work.id,
        objectVersion: 1,
        snapshotId: input.nodeId,
        payload: { sourceMode: input.sourceMode },
        actorId: input.userId,
        message: "创建作品",
      });
      let [branchWithHead] = await transaction
        .update(workBranches)
        .set({ headNodeId: input.nodeId, updatedAt: new Date() })
        .where(eq(workBranches.id, branch.id))
        .returning();
      if (!branchWithHead) {
        throw new Error("Failed to set initial branch head");
      }
      let headNodeId = branchWithHead.headNodeId;
      for (const setting of input.initialSettingEntities ?? []) {
        const now = new Date();
        const entityId = uuidv7();
        const entityVersionId = uuidv7();
        const versionNodeId = uuidv7();
        const [entity] = await transaction
          .insert(entities)
          .values({
            id: entityId,
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
            type: setting.type,
            name: setting.name,
            aliases: [],
            summary: setting.summary,
            description: setting.description,
            attributes: setting.attributes,
            tags: setting.tags,
            status: "locked",
            source: "import",
            version: 1,
            lockedAt: now,
            lockedBy: input.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!entity) {
          throw new Error("Failed to materialize imported setting");
        }
        const snapshot = {
          type: entity.type,
          name: entity.name,
          aliases: entity.aliases,
          summary: entity.summary,
          description: entity.description,
          attributes: entity.attributes,
          tags: entity.tags,
          status: entity.status,
          source: entity.source,
          version: entity.version,
          lockedAt: entity.lockedAt?.toISOString() ?? null,
          lockedBy: entity.lockedBy,
          importCandidateId: setting.importCandidateId,
        };
        await transaction.insert(versionNodes).values({
          id: versionNodeId,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          parentNodeId: headNodeId,
          nodeType: "entity_version",
          objectType: "setting",
          objectId: entity.id,
          objectVersion: 1,
          snapshotId: entityVersionId,
          payload: snapshot,
          actorId: input.userId,
          message: "导入设定",
          createdAt: now,
        });
        await transaction.insert(entityVersions).values({
          id: entityVersionId,
          entityId: entity.id,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          version: 1,
          snapshot,
          versionNodeId,
          createdBy: input.userId,
          createdAt: now,
        });
        headNodeId = versionNodeId;
      }
      if (input.initialSettingEntities?.length) {
        const [materializedBranch] = await transaction
          .update(workBranches)
          .set({ headNodeId, updatedAt: new Date() })
          .where(eq(workBranches.id, branch.id))
          .returning();
        if (!materializedBranch) {
          throw new Error("Failed to update branch head after materializing imported settings");
        }
        branchWithHead = materializedBranch;
      }

      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "work.created",
        targetType: "work",
        targetId: work.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });

      return { work, branch: branchWithHead };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
