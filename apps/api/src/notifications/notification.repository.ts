import type {
  Notification,
  NotificationListQuery,
  NotificationPayload,
  NotificationTargetType,
  NotificationType,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

type Transaction = Pick<PoolClient, "query">;

interface NotificationRow {
  id: string;
  user_id: string;
  work_id: string | null;
  branch_id: string | null;
  type: NotificationType;
  target_type: NotificationTargetType;
  target_id: string;
  payload: NotificationPayload;
  dedupe_key: string;
  read_at: Date | null;
  created_at: Date;
}

export interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface NotificationCreateInput {
  userId: string;
  workId: string | null;
  branchId: string | null;
  type: NotificationType;
  targetType: NotificationTargetType;
  targetId: string;
  payload: NotificationPayload;
  dedupeKey: string;
}

export class NotificationRepository {
  private readonly pool: Pool;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for NotificationRepository");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async record(input: NotificationCreateInput): Promise<Notification | null> {
    return this.withTenant(input.userId, async (transaction) => {
      const result = await transaction.query<NotificationRow>(
        `INSERT INTO notifications (
           id, user_id, work_id, branch_id, type, target_type, target_id,
           payload, dedupe_key, read_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NULL, now())
         ON CONFLICT (user_id, dedupe_key) DO NOTHING
         RETURNING id, user_id, work_id, branch_id, type, target_type, target_id,
                   payload, dedupe_key, read_at, created_at`,
        [
          uuidv7(),
          input.userId,
          input.workId,
          input.branchId,
          input.type,
          input.targetType,
          input.targetId,
          JSON.stringify(input.payload),
          input.dedupeKey,
        ],
      );
      return result.rows[0] ? toNotification(result.rows[0]) : null;
    });
  }

  async list(userId: string, query: NotificationListQuery): Promise<NotificationPage> {
    return this.withTenant(userId, async (transaction) => {
      let cursorCreatedAt: Date | null = null;
      let cursorId: string | null = null;
      if (query.cursor) {
        const cursor = await transaction.query<{ created_at: Date; id: string }>(
          `SELECT created_at, id
           FROM notifications
           WHERE user_id = $1 AND id = $2`,
          [userId, query.cursor],
        );
        const row = cursor.rows[0];
        if (!row) {
          throw new Error("NOTIFICATION_CURSOR_INVALID");
        }
        cursorCreatedAt = row.created_at;
        cursorId = row.id;
      }
      const result = await transaction.query<NotificationRow>(
        `SELECT id, user_id, work_id, branch_id, type, target_type, target_id,
                payload, dedupe_key, read_at, created_at
         FROM notifications
         WHERE user_id = $1
           AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
           AND (
             $3::timestamptz IS NULL
             OR (created_at, id) < ($3::timestamptz, $4::uuid)
           )
         ORDER BY created_at DESC, id DESC
         LIMIT $5`,
        [userId, query.unreadOnly ?? false, cursorCreatedAt, cursorId, query.limit + 1],
      );
      const hasMore = result.rows.length > query.limit;
      const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const unread = await transaction.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM notifications
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return {
        items: page.map(toNotification),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
        unreadCount: Number(unread.rows[0]?.count ?? 0),
      };
    });
  }

  async markRead(userId: string, notificationId: string): Promise<Notification | null> {
    return this.withTenant(userId, async (transaction) => {
      const result = await transaction.query<NotificationRow>(
        `UPDATE notifications
         SET read_at = COALESCE(read_at, now())
         WHERE user_id = $1 AND id = $2
         RETURNING id, user_id, work_id, branch_id, type, target_type, target_id,
                   payload, dedupe_key, read_at, created_at`,
        [userId, notificationId],
      );
      return result.rows[0] ? toNotification(result.rows[0]) : null;
    });
  }

  async markAllRead(userId: string): Promise<number> {
    return this.withTenant(userId, async (transaction) => {
      const result = await transaction.query(
        `UPDATE notifications
         SET read_at = now()
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return result.rowCount ?? 0;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    workId: row.work_id,
    branchId: row.branch_id,
    type: row.type,
    targetType: row.target_type,
    targetId: row.target_id,
    payload: row.payload,
    dedupeKey: row.dedupe_key,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}
