import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

const WORK_DELETION_SYSTEM_ROLE = "work_deletion";

@Injectable()
export class WorkerWorkPurgeRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async listDueWorkIds(limit = 50): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await setWorkDeletionRole(client);
      const result = await client.query<{ id: string }>(
        `SELECT work.id
           FROM works AS work
          WHERE work.deleted_at IS NOT NULL
            AND work.purge_after <= now()
            AND EXISTS (
              SELECT 1
                FROM work_export_receipts AS receipt
               WHERE receipt.work_id = work.id
                 AND receipt.user_id = work.user_id
                 AND receipt.status = 'completed'
                 AND receipt.expires_at > now()
                 AND receipt.artifact_object_key IS NOT NULL
            )
          ORDER BY work.purge_after
          LIMIT $1`,
        [limit],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => row.id);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async purge(workId: string): Promise<string[] | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await setWorkDeletionRole(client);
      const [work] = (
        await client.query<{
          id: string;
          userId: string;
          coverObjectKey: string | null;
        }>(
          `SELECT id, user_id AS "userId", cover_object_key AS "coverObjectKey"
             FROM works
            WHERE id = $1
              AND deleted_at IS NOT NULL
              AND purge_after <= now()
            FOR UPDATE`,
          [workId],
        )
      ).rows;
      if (!work) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query("SELECT set_config('app.user_id', $1, true)", [work.userId]);
      const exports = await client.query<{ artifact_object_key: string }>(
        `SELECT artifact_object_key
           FROM work_export_receipts
          WHERE work_id = $1
            AND user_id = $2
            AND status = 'completed'
            AND expires_at > now()
            AND artifact_object_key IS NOT NULL
          ORDER BY created_at`,
        [work.id, work.userId],
      );
      if (exports.rows.length === 0) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query("DELETE FROM works WHERE id = $1 AND user_id = $2", [
        work.id,
        work.userId,
      ]);
      await client.query(
        `INSERT INTO audit_logs
          (id, actor_id, action, target_type, target_id, decision, correlation_id, ip, user_agent)
         VALUES ($1, $2, 'work.purged', 'work', $3, 'allowed', $4, 'worker', 'work-purge')`,
        [uuidv7(), work.userId, work.id, `work-purge:${work.id}`],
      );
      await client.query("COMMIT");
      return [
        ...new Set([
          ...exports.rows.map((row) => row.artifact_object_key),
          ...(work.coverObjectKey ? [work.coverObjectKey] : []),
        ]),
      ];
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

async function setWorkDeletionRole(client: PoolClient): Promise<void> {
  await client.query("SELECT set_config('app.system_role', $1, true)", [WORK_DELETION_SYSTEM_ROLE]);
}
