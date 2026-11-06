import { createHash } from "node:crypto";

import type {
  AgentGrant,
  AgentGrantBudgetLimits,
  AgentGrantCreateRequest,
  AgentGrantMaxImpact,
  AgentResourceScope,
} from "@novel-brain/contracts";
import { agentGrantSchema } from "@novel-brain/contracts";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { createDatabaseClient, createDatabasePool, type DatabaseClient } from "./client";
import { findIdempotentResource, rememberIdempotentResource } from "./idempotency";
import { agentGrants, agentToolCalls, auditLogs, workBranches, works } from "./schema";

export type AgentGrantRecord = InferSelectModel<typeof agentGrants>;
export type AgentToolCallRecord = InferSelectModel<typeof agentToolCalls>;
export type AgentGrantState = "active" | "revoked" | "expired";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface AgentGrantScope {
  workId: string;
  branchId: string;
}

export interface AgentGrantAudit {
  requestId: string;
  ip: string;
  userAgent: string;
}

export type AgentGrantRevokeResult = AgentGrantRecord | "not_found" | "version_conflict";

export interface AgentToolAuthorizationDecision {
  decision: "allow" | "deny";
  reason: string;
  toolName: string;
  sideEffect: string | null;
  approvalRequired: boolean;
}

export interface AgentToolAuthorizationInput {
  userId: string;
  workId: string;
  branchId: string;
  taskId: string;
  grantId: string;
  agentRunId?: string | null;
  toolName: string;
  resource: { type: string; id: string | null };
  input: Record<string, unknown>;
  affectedResources: number;
  estimatedCostCny: number;
  estimatedTokens: number;
  audit: AgentGrantAudit;
}

export interface AgentToolAuthorizationResult {
  decision: AgentToolAuthorizationDecision;
  grant: AgentGrantRecord | null;
}

export function deriveAgentGrantState(record: AgentGrantRecord, now = new Date()): AgentGrantState {
  if (record.status === "revoked" || record.revokedAt) {
    return "revoked";
  }
  return record.expiresAt.getTime() <= now.getTime() ? "expired" : "active";
}

export class AgentGrantStore {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async scopeExists(userId: string, scope: AgentGrantScope): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      return Boolean(await this.scopeRow(transaction, userId, scope, false));
    });
  }

  async createGrant(input: {
    userId: string;
    scope: AgentGrantScope;
    request: AgentGrantCreateRequest;
    audit: AgentGrantAudit;
    idempotencyKey: string;
  }): Promise<AgentGrantRecord | null> {
    return this.withTenant(input.userId, async (transaction) => {
      if (!(await this.lockScope(transaction, input.userId, input.scope))) {
        return null;
      }
      const existing = await findIdempotentResource(
        transaction,
        input.userId,
        "agent-grants",
        input.idempotencyKey,
      );
      if (existing) {
        const [record] = await transaction
          .select()
          .from(agentGrants)
          .where(
            and(
              eq(agentGrants.id, existing.resourceId),
              eq(agentGrants.userId, input.userId),
              eq(agentGrants.workId, input.scope.workId),
              eq(agentGrants.branchId, input.scope.branchId),
            ),
          )
          .limit(1);
        return record ?? null;
      }
      const id = uuidv7();
      const [record] = await transaction
        .insert(agentGrants)
        .values({
          id,
          workId: input.scope.workId,
          branchId: input.scope.branchId,
          userId: input.userId,
          taskId: input.request.taskId,
          role: input.request.role,
          status: "active",
          toolNames: [...input.request.tools],
          resourceScope: input.request.resourceScope as unknown as Record<string, unknown>,
          budget: {
            ...input.request.budget,
            spentCostCny: 0,
            spentTokens: 0,
            callCount: 0,
          },
          maxImpact: input.request.maxImpact as unknown as Record<string, unknown>,
          expiresAt: new Date(input.request.expiresAt),
          issuedBy: input.userId,
        })
        .returning();
      if (!record) {
        throw new Error("Agent grant insert returned no row");
      }
      await this.writeAudit(transaction, {
        actorId: input.userId,
        action: "agent_grant.issue",
        targetId: record.id,
        decision: "allow",
        audit: input.audit,
      });
      await rememberIdempotentResource(
        transaction,
        input.userId,
        "agent-grants",
        input.idempotencyKey,
        { resourceType: "agent_grant", resourceId: record.id },
      );
      return record;
    });
  }

  async listGrants(userId: string, scope: AgentGrantScope): Promise<AgentGrantRecord[]> {
    return this.withTenant(userId, async (transaction) => {
      return transaction
        .select()
        .from(agentGrants)
        .where(
          and(
            eq(agentGrants.userId, userId),
            eq(agentGrants.workId, scope.workId),
            eq(agentGrants.branchId, scope.branchId),
          ),
        )
        .orderBy(asc(agentGrants.createdAt));
    });
  }

  async findGrant(
    userId: string,
    scope: AgentGrantScope,
    grantId: string,
  ): Promise<AgentGrantRecord | null> {
    return this.withTenant(userId, async (transaction) => {
      const [record] = await transaction
        .select()
        .from(agentGrants)
        .where(
          and(
            eq(agentGrants.id, grantId),
            eq(agentGrants.userId, userId),
            eq(agentGrants.workId, scope.workId),
            eq(agentGrants.branchId, scope.branchId),
          ),
        )
        .limit(1);
      return record ?? null;
    });
  }

  async revokeGrant(input: {
    userId: string;
    scope: AgentGrantScope;
    grantId: string;
    reason: string;
    version: number;
    audit: AgentGrantAudit;
  }): Promise<AgentGrantRevokeResult> {
    return this.withTenant(input.userId, async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(agentGrants)
        .where(
          and(
            eq(agentGrants.id, input.grantId),
            eq(agentGrants.userId, input.userId),
            eq(agentGrants.workId, input.scope.workId),
            eq(agentGrants.branchId, input.scope.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!existing) {
        return "not_found";
      }
      if (existing.status === "revoked") {
        return existing.revocationReason === input.reason ? existing : "version_conflict";
      }
      if (existing.version !== input.version) {
        return "version_conflict";
      }
      const now = new Date();
      const [record] = await transaction
        .update(agentGrants)
        .set({
          status: "revoked",
          revokedAt: now,
          revokedBy: input.userId,
          revocationReason: input.reason,
          version: existing.version + 1,
          updatedAt: now,
        })
        .where(and(eq(agentGrants.id, input.grantId), eq(agentGrants.version, existing.version)))
        .returning();
      if (!record) {
        throw new Error("Agent grant revocation returned no row");
      }
      await this.writeAudit(transaction, {
        actorId: input.userId,
        action: "agent_grant.revoke",
        targetId: record.id,
        decision: "allow",
        audit: input.audit,
      });
      return record;
    });
  }

  async recordDispatchCheck(input: {
    userId: string;
    grantId: string;
    decision: "allow" | "deny";
    audit: AgentGrantAudit;
  }): Promise<void> {
    await this.withTenant(input.userId, async (transaction) => {
      await this.writeAudit(transaction, {
        actorId: input.userId,
        action: "agent_grant.dispatch_check",
        targetId: input.grantId,
        decision: input.decision,
        audit: input.audit,
      });
    });
  }

  async authorizeToolCall<TDecision extends AgentToolAuthorizationDecision>(
    input: AgentToolAuthorizationInput,
    evaluate: (grant: AgentGrantRecord, now: Date) => TDecision,
  ): Promise<AgentToolAuthorizationResult> {
    return this.withTenant(input.userId, async (transaction) => {
      const now = new Date();
      const [grant] = await transaction
        .select()
        .from(agentGrants)
        .where(
          and(
            eq(agentGrants.id, input.grantId),
            eq(agentGrants.userId, input.userId),
            eq(agentGrants.workId, input.workId),
            eq(agentGrants.branchId, input.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!grant) {
        const decision: AgentToolAuthorizationDecision = {
          decision: "deny",
          reason: "grant_not_found",
          toolName: input.toolName,
          sideEffect: null,
          approvalRequired: false,
        };
        await this.writeAudit(transaction, {
          actorId: input.userId,
          action: "agent_tool_call.authorize",
          targetId: input.grantId,
          decision: "deny",
          audit: input.audit,
        });
        return { decision, grant: null };
      }

      const decision = evaluate(grant, now);
      let updated = grant;
      if (decision.decision === "allow") {
        const budget = grant.budget as {
          maxCostCny: number;
          maxTokens: number;
          maxCalls: number;
          spentCostCny: number;
          spentTokens: number;
          callCount: number;
        };
        const [reserved] = await transaction
          .update(agentGrants)
          .set({
            budget: {
              ...budget,
              spentCostCny: budget.spentCostCny + input.estimatedCostCny,
              spentTokens: budget.spentTokens + input.estimatedTokens,
              callCount: budget.callCount + 1,
            },
            updatedAt: now,
          })
          .where(
            and(
              eq(agentGrants.id, input.grantId),
              eq(agentGrants.status, "active"),
              isNull(agentGrants.revokedAt),
              sql`${agentGrants.expiresAt} > now()`,
            ),
          )
          .returning();
        if (!reserved) {
          const denied: AgentToolAuthorizationDecision = {
            ...decision,
            decision: "deny",
            reason: "grant_revoked",
          };
          await this.recordToolCall(transaction, input, grant, decision.sideEffect, denied);
          return { decision: denied, grant };
        }
        updated = reserved;
      }

      await this.recordToolCall(transaction, input, grant, decision.sideEffect, decision);
      return { decision, grant: updated };
    });
  }

  private async lockScope(
    transaction: DatabaseTransaction,
    userId: string,
    scope: AgentGrantScope,
  ): Promise<boolean> {
    return Boolean(await this.scopeRow(transaction, userId, scope, true));
  }

  private async scopeRow(
    transaction: DatabaseTransaction,
    userId: string,
    scope: AgentGrantScope,
    lock: boolean,
  ): Promise<{ id: string } | undefined> {
    const query = transaction
      .select({ id: workBranches.id })
      .from(workBranches)
      .innerJoin(
        works,
        and(eq(works.id, workBranches.workId), eq(works.userId, workBranches.userId)),
      )
      .where(
        and(
          eq(works.id, scope.workId),
          eq(works.userId, userId),
          isNull(works.deletedAt),
          eq(workBranches.id, scope.branchId),
          eq(workBranches.workId, scope.workId),
          eq(workBranches.userId, userId),
        ),
      )
      .limit(1);
    const rows = lock ? await query.for("update") : await query;
    return rows[0];
  }

  private async recordToolCall(
    transaction: DatabaseTransaction,
    input: AgentToolAuthorizationInput,
    grant: AgentGrantRecord,
    sideEffect: string | null,
    decision: AgentToolAuthorizationDecision,
  ): Promise<void> {
    await transaction.insert(agentToolCalls).values({
      id: uuidv7(),
      grantId: grant.id,
      agentRunId: input.agentRunId ?? null,
      workId: grant.workId,
      branchId: grant.branchId,
      userId: grant.userId,
      taskId: grant.taskId,
      toolName: input.toolName,
      sideEffect,
      decision: decision.decision,
      reason: decision.reason,
      resourceType: input.resource.type,
      resourceId: input.resource.id,
      inputHash: createHash("sha256").update(stableStringify(input.input)).digest("hex"),
      inputSummary: summarize(input.input),
      outputSummary: null,
      affectedResources: input.affectedResources,
      estimatedCostCny: input.estimatedCostCny,
      estimatedTokens: input.estimatedTokens,
      status: decision.decision === "allow" ? "authorized" : "denied",
    });
    await this.writeAudit(transaction, {
      actorId: input.userId,
      action: "agent_tool_call.authorize",
      targetId: grant.id,
      decision: decision.decision,
      audit: input.audit,
    });
  }

  private async writeAudit(
    transaction: DatabaseTransaction,
    input: {
      actorId: string;
      action: string;
      targetId: string;
      decision: "allow" | "deny";
      audit: AgentGrantAudit;
    },
  ): Promise<void> {
    await transaction.insert(auditLogs).values({
      id: uuidv7(),
      actorId: input.actorId,
      action: input.action,
      targetType: "agent_grant",
      targetId: input.targetId,
      decision: input.decision,
      correlationId: input.audit.requestId,
      ip: input.audit.ip,
      userAgent: input.audit.userAgent,
    });
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
}

export function grantRequestParts(record: AgentGrantRecord): {
  resourceScope: AgentResourceScope;
  budget: AgentGrantBudgetLimits & {
    spentCostCny: number;
    spentTokens: number;
    callCount: number;
  };
  maxImpact: AgentGrantMaxImpact;
} {
  return {
    resourceScope: record.resourceScope as unknown as AgentResourceScope,
    budget: record.budget as unknown as AgentGrantBudgetLimits & {
      spentCostCny: number;
      spentTokens: number;
      callCount: number;
    },
    maxImpact: record.maxImpact as unknown as AgentGrantMaxImpact,
  };
}

export function toAgentGrantContract(record: AgentGrantRecord, now = new Date()): AgentGrant {
  const parts = grantRequestParts(record);
  return agentGrantSchema.parse({
    id: record.id,
    workId: record.workId,
    branchId: record.branchId,
    taskId: record.taskId,
    userId: record.userId,
    role: record.role,
    state: deriveAgentGrantState(record, now),
    tools: record.toolNames,
    resourceScope: parts.resourceScope,
    budget: parts.budget,
    maxImpact: parts.maxImpact,
    expiresAt: record.expiresAt.toISOString(),
    issuedBy: record.issuedBy,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    revokedBy: record.revokedBy,
    revocationReason: record.revocationReason,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
  });
}

function summarize(input: Record<string, unknown>): Record<string, unknown> {
  return {
    keys: Object.keys(input).sort(),
    sizeBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
