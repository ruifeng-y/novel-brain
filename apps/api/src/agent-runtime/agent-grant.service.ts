import { Injectable } from "@nestjs/common";
import {
  type AgentGrant,
  type AgentGrantCreateRequest,
  type AgentGrantRevokeRequest,
} from "@novel-brain/contracts";
import { getToolRegistryEntry, isToolAllowedForRole } from "@novel-brain/core";
import { toAgentGrantContract, type AgentGrantAudit, type AgentGrantScope } from "@novel-brain/db";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentRuntimeRepository } from "./agent-runtime.repository";

@Injectable()
export class AgentGrantService {
  constructor(private readonly repository: AgentRuntimeRepository) {}

  async create(
    userId: string,
    scope: AgentGrantScope,
    request: AgentGrantCreateRequest,
    idempotencyKey: string,
    audit: AgentGrantAudit,
  ): Promise<AgentGrant> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    if (Date.parse(request.expiresAt) <= Date.now()) {
      throw new ApiError(400, "AGENT_GRANT_INVALID", "授权到期时间必须晚于当前时间");
    }
    for (const toolName of request.tools) {
      const entry = getToolRegistryEntry(toolName);
      if (!entry || !entry.agentCallable) {
        throw new ApiError(400, "AGENT_GRANT_INVALID", `工具未注册或不接受代理调用：${toolName}`);
      }
      if (!isToolAllowedForRole(request.role, toolName)) {
        throw new ApiError(
          400,
          "AGENT_GRANT_INVALID",
          `角色 ${request.role} 不能获得工具 ${toolName}`,
        );
      }
    }
    const record = await this.repository.createGrant({
      userId,
      scope,
      request,
      audit,
      idempotencyKey: normalizedKey,
    });
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，无权签发授权");
    }
    return toAgentGrantContract(record);
  }

  async list(userId: string, scope: AgentGrantScope): Promise<AgentGrant[]> {
    if (!(await this.repository.scopeExists(userId, scope))) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，无权访问授权");
    }
    return (await this.repository.listGrants(userId, scope)).map((record) =>
      toAgentGrantContract(record),
    );
  }

  async get(userId: string, scope: AgentGrantScope, grantId: string): Promise<AgentGrant> {
    const record = await this.repository.findGrant(userId, scope, grantId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "授权不存在或无权访问");
    }
    return toAgentGrantContract(record);
  }

  async revoke(
    userId: string,
    scope: AgentGrantScope,
    grantId: string,
    request: AgentGrantRevokeRequest,
    audit: AgentGrantAudit,
  ): Promise<AgentGrant> {
    const record = await this.repository.revokeGrant({
      userId,
      scope,
      grantId,
      reason: request.reason,
      version: request.version,
      audit,
    });
    if (record === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "授权不存在或无权撤销");
    }
    if (record === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "授权已被其他操作更新，请刷新后重试");
    }
    return toAgentGrantContract(record);
  }
}
