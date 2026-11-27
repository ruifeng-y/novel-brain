import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  createDatabaseClient,
  createDatabasePool,
  jobs,
  modelConfigs,
  workBlueprints,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import type { GenerateBlueprintJob } from "@novel-brain/contracts";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";

export type WorkBlueprintRecord = InferSelectModel<typeof workBlueprints>;
export type BlueprintJobRecord = InferSelectModel<typeof jobs>;

export type BlueprintLookup =
  | { kind: "forbidden" }
  | { kind: "missing" }
  | { kind: "ok"; blueprint: WorkBlueprintRecord; job: BlueprintJobRecord };

@Injectable()
export class BlueprintRepository implements OnModuleDestroy {
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

  async preferredModelConfigId(userId: string): Promise<string | null> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ id: modelConfigs.id, purposes: modelConfigs.purposes })
        .from(modelConfigs)
        .where(and(eq(modelConfigs.userId, userId), isNull(modelConfigs.deletedAt)))
        .orderBy(desc(modelConfigs.isDefault), desc(modelConfigs.updatedAt));
      return rows.find((row) => row.purposes.includes("planning"))?.id ?? null;
    });
  }

  async find(userId: string, workId: string, branchId: string): Promise<BlueprintLookup> {
    return this.withTenant(userId, async (transaction) => {
      const [scope] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
        .from(works)
        .innerJoin(
          workBranches,
          and(eq(workBranches.workId, works.id), eq(workBranches.userId, works.userId)),
        )
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(workBranches.id, branchId),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      if (!scope) {
        return { kind: "forbidden" };
      }

      const [row] = await transaction
        .select({ blueprint: workBlueprints, job: jobs })
        .from(workBlueprints)
        .innerJoin(jobs, eq(jobs.id, workBlueprints.jobId))
        .where(
          and(
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.workId, workId),
            eq(workBlueprints.branchId, branchId),
          ),
        )
        .limit(1);
      return row ? { kind: "ok", ...row } : { kind: "missing" };
    });
  }

  async requeuePayload(
    userId: string,
    workId: string,
    branchId: string,
    allowRecovery = false,
  ): Promise<GenerateBlueprintJob | null> {
    const lookup = await this.find(userId, workId, branchId);
    if (lookup.kind !== "ok") {
      return null;
    }
    const recoverable = ["queued", "failed", "budget_paused", "waiting_model_config"];
    if (
      !recoverable.includes(lookup.blueprint.status) ||
      (!allowRecovery && lookup.blueprint.status !== "queued")
    ) {
      return null;
    }
    const modelConfigId =
      lookup.blueprint.status === "waiting_model_config"
        ? ((await this.preferredModelConfigId(userId)) ?? lookup.job.modelConfigId)
        : lookup.job.modelConfigId;
    if (lookup.blueprint.status !== "queued") {
      await this.withTenant(userId, async (transaction) => {
        await transaction.execute(
          sql`UPDATE jobs
                 SET status = 'queued', model_config_id = ${modelConfigId},
                     error_code = NULL, error_message = NULL,
                     finished_at = NULL, updated_at = now()
               WHERE id = ${lookup.job.id} AND user_id = ${userId}`,
        );
        await transaction.execute(
          sql`UPDATE work_blueprints
                 SET status = 'queued', updated_at = now()
               WHERE id = ${lookup.blueprint.id} AND user_id = ${userId}`,
        );
      });
    }
    return {
      jobId: lookup.job.id,
      jobType: "generate_blueprint",
      workId: lookup.job.workId,
      branchId: lookup.job.branchId,
      actorId: lookup.job.userId,
      modelConfigId,
      idempotencyKey: lookup.job.idempotencyKey,
      budget: lookup.job.budget as GenerateBlueprintJob["budget"],
      checkpoint: lookup.job.checkpoint as GenerateBlueprintJob["checkpoint"],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (
      transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}
