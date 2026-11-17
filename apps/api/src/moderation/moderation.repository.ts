import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  moderationCaseSchema,
  moderationAppealRequestSchema,
  type ModerationAppeal,
  type ModerationCase,
  type ModerationCaseListQuery,
  type ModerationCaseStatus,
  type ModerationEvent,
  type ModerationEventType,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

export interface ModerationContext {
  workId: string;
  branchId: string;
}

type CaseRow = {
  id: string;
  work_id: string;
  branch_id: string;
  publish_preview_id: string;
  export_id: string;
  status: ModerationCaseStatus;
  rule_version: string;
  evidence: ModerationCase["evidence"];
  created_at: Date;
  updated_at: Date;
};

type EventRow = {
  id: string;
  case_id: string;
  type: ModerationEventType;
  appeal_id: string | null;
  from_status: ModerationCaseStatus | null;
  to_status: ModerationCaseStatus;
  reason: string | null;
  created_at: Date;
};

type AppealRow = {
  id: string;
  case_id: string;
  status: ModerationAppeal["status"];
  reason: string;
  correction: string | null;
  created_at: Date;
  updated_at: Date;
  withdrawn_at: Date | null;
};

type IdempotencyRow = {
  request_hash: string;
  resource_type: string;
  resource_id: string;
};

@Injectable()
export class ModerationRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async list(
    userId: string,
    context: ModerationContext,
    query: ModerationCaseListQuery,
  ): Promise<{ cases: ModerationCase[]; nextCursor: string | null }> {
    return this.withTenant(userId, async (client) => {
      await this.assertContext(client, userId, context);
      const result = await client.query<CaseRow>(
        `SELECT id, work_id, branch_id, publish_preview_id, export_id, status,
                rule_version, evidence, created_at, updated_at
           FROM moderation_cases
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
            AND (
              $4::uuid IS NULL
              OR (created_at, id) < (
                SELECT anchor.created_at, anchor.id
                  FROM moderation_cases anchor
                 WHERE anchor.id = $4 AND anchor.user_id = $1
                   AND anchor.work_id = $2 AND anchor.branch_id = $3
              )
            )
          ORDER BY created_at DESC, id DESC
          LIMIT $5`,
        [userId, context.workId, context.branchId, query.cursor ?? null, query.limit + 1],
      );
      const hasMore = result.rows.length > query.limit;
      const rows = result.rows.slice(0, query.limit);
      const cases = await this.hydrateCases(client, userId, context, rows);
      return {
        cases,
        nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
      };
    });
  }

  async submitAppeal(
    userId: string,
    context: ModerationContext,
    caseId: string,
    request: unknown,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ModerationCase | "conflict"> {
    const body = moderationAppealRequestSchema.parse(request);
    return this.withTenant(userId, async (client) => {
      await this.assertContext(client, userId, context);
      const scope = appealScope(context, caseId);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${userId}:${scope}:${idempotencyKey}`,
      ]);
      const replay = await client.query<IdempotencyRow>(
        `SELECT request_hash, resource_type, resource_id
           FROM idempotency_records
          WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3
            AND created_at > now() - interval '24 hours'`,
        [userId, scope, idempotencyKey],
      );
      const previous = replay.rows[0];
      if (previous) {
        if (
          previous.request_hash !== requestHash ||
          previous.resource_type !== "moderation_appeal"
        ) {
          return "conflict";
        }
        const snapshot = await client.query<{ result_snapshot: unknown }>(
          `SELECT result_snapshot FROM moderation_appeals
            WHERE id = $1 AND case_id = $2 AND user_id = $3
              AND work_id = $4 AND branch_id = $5`,
          [previous.resource_id, caseId, userId, context.workId, context.branchId],
        );
        if (!snapshot.rows[0]?.result_snapshot) {
          return "conflict";
        }
        return moderationCaseSchema.parse(snapshot.rows[0].result_snapshot);
      }

      const locked = await this.getCaseRow(client, userId, context, caseId, true);
      if (!locked) {
        throw new ModerationCaseNotFoundError();
      }
      if (locked.status === "clear") {
        throw new ModerationAppealNotRequiredError();
      }
      if (locked.status === "appeal_submitted") {
        throw new ModerationAppealAlreadySubmittedError();
      }
      const appealCount = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM moderation_appeals
          WHERE case_id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
        [caseId, userId, context.workId, context.branchId],
      );
      if ((appealCount.rows[0]?.count ?? 0) >= 20) {
        throw new ModerationAppealLimitReachedError();
      }

      const now = new Date();
      const appealId = uuidv7();
      await client.query(
        `INSERT INTO moderation_appeals
          (id, case_id, user_id, work_id, branch_id, status, reason, correction,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8, $8)`,
        [
          appealId,
          caseId,
          userId,
          context.workId,
          context.branchId,
          body.reason,
          body.correction ?? null,
          now,
        ],
      );
      await client.query(
        `UPDATE moderation_cases
            SET status = 'appeal_submitted', updated_at = $1
          WHERE id = $2 AND user_id = $3 AND work_id = $4 AND branch_id = $5`,
        [now, caseId, userId, context.workId, context.branchId],
      );
      await client.query(
        `INSERT INTO moderation_events
          (id, case_id, user_id, work_id, branch_id, type, appeal_id,
           from_status, to_status, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, 'appeal_submitted', $6, $7,
                 'appeal_submitted', $8, $9)`,
        [
          uuidv7(),
          caseId,
          userId,
          context.workId,
          context.branchId,
          appealId,
          locked.status,
          body.reason,
          now,
        ],
      );
      await client.query(
        `INSERT INTO idempotency_records
          (id, user_id, scope, idempotency_key, request_hash, resource_type, resource_id, created_at)
         VALUES ($1, $2, $3, $4, $5, 'moderation_appeal', $6, $7)
         ON CONFLICT (user_id, scope, idempotency_key) DO UPDATE
           SET id = EXCLUDED.id,
               request_hash = EXCLUDED.request_hash,
               resource_type = EXCLUDED.resource_type,
               resource_id = EXCLUDED.resource_id,
               created_at = EXCLUDED.created_at
         WHERE idempotency_records.created_at <= now() - interval '24 hours'`,
        [uuidv7(), userId, scope, idempotencyKey, requestHash, appealId, now],
      );
      const updated = await this.getCaseRow(client, userId, context, caseId, false);
      if (!updated) {
        throw new ModerationCaseNotFoundError();
      }
      const result = await this.hydrateCase(client, userId, context, updated);
      await client.query(
        `UPDATE moderation_appeals
            SET result_snapshot = $1::jsonb
          WHERE id = $2 AND case_id = $3 AND user_id = $4
            AND work_id = $5 AND branch_id = $6`,
        [JSON.stringify(result), appealId, caseId, userId, context.workId, context.branchId],
      );
      return result;
    });
  }

  async withdrawAppeal(
    userId: string,
    context: ModerationContext,
    caseId: string,
    appealId: string,
  ): Promise<ModerationCase> {
    return this.withTenant(userId, async (client) => {
      await this.assertContext(client, userId, context);
      const locked = await this.getCaseRow(client, userId, context, caseId, true);
      if (!locked) {
        throw new ModerationCaseNotFoundError();
      }
      const appeal = await client.query<{
        id: string;
        status: "submitted" | "withdrawn";
      }>(
        `SELECT id, status FROM moderation_appeals
          WHERE id = $1 AND case_id = $2 AND user_id = $3
            AND work_id = $4 AND branch_id = $5
          FOR UPDATE`,
        [appealId, caseId, userId, context.workId, context.branchId],
      );
      const found = appeal.rows[0];
      if (!found) {
        throw new ModerationAppealNotFoundError();
      }
      if (found.status === "withdrawn") {
        return this.hydrateCase(client, userId, context, locked);
      }
      const now = new Date();
      await client.query(
        `UPDATE moderation_appeals
            SET status = 'withdrawn', withdrawn_at = $1, updated_at = $1
          WHERE id = $2 AND case_id = $3 AND user_id = $4
            AND work_id = $5 AND branch_id = $6`,
        [now, appealId, caseId, userId, context.workId, context.branchId],
      );
      await client.query(
        `UPDATE moderation_cases
            SET status = 'needs_review', updated_at = $1
          WHERE id = $2 AND user_id = $3 AND work_id = $4 AND branch_id = $5`,
        [now, caseId, userId, context.workId, context.branchId],
      );
      await client.query(
        `INSERT INTO moderation_events
          (id, case_id, user_id, work_id, branch_id, type, appeal_id,
           from_status, to_status, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, 'appeal_withdrawn', $6,
                 'appeal_submitted', 'needs_review', $7, $8)`,
        [uuidv7(), caseId, userId, context.workId, context.branchId, appealId, "作者撤回申诉", now],
      );
      const updated = await this.getCaseRow(client, userId, context, caseId, false);
      if (!updated) {
        throw new ModerationCaseNotFoundError();
      }
      return this.hydrateCase(client, userId, context, updated);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async getCaseRow(
    client: PoolClient,
    userId: string,
    context: ModerationContext,
    caseId: string,
    lock: boolean,
  ): Promise<CaseRow | undefined> {
    const result = await client.query<CaseRow>(
      `SELECT id, work_id, branch_id, publish_preview_id, export_id, status,
              rule_version, evidence, created_at, updated_at
         FROM moderation_cases
        WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
        ${lock ? "FOR UPDATE" : ""}`,
      [caseId, userId, context.workId, context.branchId],
    );
    return result.rows[0];
  }

  private async hydrateCases(
    client: PoolClient,
    userId: string,
    context: ModerationContext,
    rows: CaseRow[],
  ): Promise<ModerationCase[]> {
    return Promise.all(rows.map((row) => this.hydrateCase(client, userId, context, row)));
  }

  private async hydrateCase(
    client: PoolClient,
    userId: string,
    context: ModerationContext,
    row: CaseRow,
  ): Promise<ModerationCase> {
    const [events, appeals] = await Promise.all([
      client.query<EventRow>(
        `SELECT id, case_id, type, appeal_id, from_status, to_status, reason, created_at
           FROM moderation_events
          WHERE case_id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
          ORDER BY created_at, id`,
        [row.id, userId, context.workId, context.branchId],
      ),
      client.query<AppealRow>(
        `SELECT id, case_id, status, reason, correction, created_at, updated_at, withdrawn_at
           FROM moderation_appeals
          WHERE case_id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
          ORDER BY created_at, id`,
        [row.id, userId, context.workId, context.branchId],
      ),
    ]);
    return {
      id: row.id,
      workId: row.work_id,
      branchId: row.branch_id,
      publishPreviewId: row.publish_preview_id,
      exportId: row.export_id,
      status: row.status,
      ruleVersion: row.rule_version,
      evidence: row.evidence,
      events: events.rows.map((event) => ({
        id: event.id,
        type: event.type,
        appealId: event.appeal_id,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        reason: event.reason,
        createdAt: event.created_at.toISOString(),
      })) satisfies ModerationEvent[],
      appeals: appeals.rows.map((appeal) => ({
        id: appeal.id,
        status: appeal.status,
        reason: appeal.reason,
        correction: appeal.correction,
        createdAt: appeal.created_at.toISOString(),
        updatedAt: appeal.updated_at.toISOString(),
        withdrawnAt: appeal.withdrawn_at?.toISOString() ?? null,
      })) satisfies ModerationAppeal[],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async assertContext(
    client: PoolClient,
    userId: string,
    context: ModerationContext,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1
         FROM works work
         JOIN work_branches branch
           ON branch.work_id = work.id AND branch.user_id = work.user_id
        WHERE work.id = $1 AND branch.id = $2 AND work.user_id = $3
          AND work.deleted_at IS NULL`,
      [context.workId, context.branchId, userId],
    );
    if (result.rowCount !== 1) {
      throw new ModerationContextNotFoundError();
    }
  }

  private async withTenant<T>(
    userId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

export class ModerationContextNotFoundError extends Error {}
export class ModerationCaseNotFoundError extends Error {}
export class ModerationAppealNotRequiredError extends Error {}
export class ModerationAppealAlreadySubmittedError extends Error {}
export class ModerationAppealNotFoundError extends Error {}
export class ModerationAppealLimitReachedError extends Error {}

function appealScope(context: ModerationContext, caseId: string): string {
  return `moderation-appeal:${context.workId}:${context.branchId}:${caseId}`;
}
