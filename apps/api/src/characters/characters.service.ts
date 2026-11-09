import { Injectable } from "@nestjs/common";
import {
  type CharacterChangeRequest,
  type CharacterChangeRequestCreateRequest,
  type CharacterCreateRequest,
  type CharacterDetail,
  type CharacterHistory,
  type CharacterHistoryQuery,
  type CharacterKnowledgeProjection,
  type CharacterKnowledgeState,
  type CharacterKnowledgeStateCreateRequest,
  type CharacterProfileUpdateRequest,
  type CharacterRelationship,
  type CharacterRelationshipCreateRequest,
  type CharacterStateTransition,
  type CharacterStateTransitionCreateRequest,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CharactersRepository } from "./characters.repository";
import type {
  CharacterAuditContext,
  CharacterWorkContext,
  CharacterWriteResult,
} from "./characters.repository";

@Injectable()
export class CharactersService {
  constructor(private readonly repository: CharactersRepository) {}

  async list(userId: string, workId: string, branchId: string): Promise<CharacterDetail[]> {
    const context = await this.requireContext(userId, workId, branchId);
    return this.repository.list(userId, context);
  }

  async get(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
  ): Promise<CharacterDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    const detail = await this.repository.getDetail(userId, context, characterId);
    if (!detail) {
      throw tenantError();
    }
    return detail;
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: CharacterCreateRequest,
    audit: CharacterAuditContext,
  ): Promise<CharacterDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.create(userId, context, input, audit));
  }

  async updateProfile(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    input: CharacterProfileUpdateRequest,
    audit: CharacterAuditContext,
  ): Promise<CharacterDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.updateProfile(userId, context, characterId, input, audit));
  }

  async addRelationship(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    input: CharacterRelationshipCreateRequest,
    audit: CharacterAuditContext,
  ): Promise<CharacterRelationship> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.addRelationship(userId, context, characterId, input, audit),
    );
  }

  async addStateTransition(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    input: CharacterStateTransitionCreateRequest,
    audit: CharacterAuditContext,
  ): Promise<CharacterStateTransition> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.addStateTransition(userId, context, characterId, input, audit),
    );
  }

  async addKnowledgeState(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    input: CharacterKnowledgeStateCreateRequest,
    audit: CharacterAuditContext,
  ): Promise<CharacterKnowledgeState> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.addKnowledgeState(userId, context, characterId, input, audit),
    );
  }

  async lock(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    version: number,
    audit: CharacterAuditContext,
  ): Promise<CharacterDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.lock(userId, context, characterId, version, audit));
  }

  async history(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    query: CharacterHistoryQuery,
  ): Promise<CharacterHistory> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.history(userId, context, characterId, query));
  }

  async knowledge(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    chapterNumber: number,
  ): Promise<CharacterKnowledgeProjection> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.knowledgeAtChapter(userId, context, characterId, chapterNumber),
    );
  }

  async listChangeRequests(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
  ): Promise<CharacterChangeRequest[]> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.listChangeRequests(userId, context, characterId));
  }

  async createChangeRequest(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    input: CharacterChangeRequestCreateRequest,
    audit: CharacterAuditContext,
    idempotencyKey?: string,
  ): Promise<CharacterChangeRequest> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.createChangeRequest(
        userId,
        context,
        characterId,
        input,
        audit,
        idempotencyKey,
      ),
    );
  }

  private async requireContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<CharacterWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw tenantError();
    }
    return context;
  }
}

function unwrap<T>(result: CharacterWriteResult<T>): T {
  if (result.kind === "ok") {
    return result.value;
  }
  switch (result.kind) {
    case "not_found":
      throw tenantError();
    case "locked":
      throw new ApiError(409, "SETTING_LOCKED", "人物档案已锁定，请提交修改请求");
    case "proposal_state":
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "人物档案正在提案或已废弃，不能直接编辑");
    case "version_conflict":
      throw new ApiError(409, "VERSION_CONFLICT", "人物档案已被其他操作更新，请刷新后重试");
    case "name_conflict":
      throw new ApiError(409, "SETTING_NAME_CONFLICT", "人物名称已存在");
    case "alias_conflict":
      throw new ApiError(409, "SETTING_ALIAS_CONFLICT", "人物别名与其他设定冲突");
    case "state_overlap":
      throw new ApiError(409, "CHARACTER_STATE_OVERLAP", "同一人物状态的生效章节不能重叠");
    case "fact_not_found":
      throw new ApiError(400, "VALIDATION_INVALID", "客观事实不存在或不属于当前分支");
    case "target_not_found":
      throw new ApiError(400, "VALIDATION_INVALID", "关系或位置引用的目标不存在");
    case "custom_field_required":
      throw new ApiError(400, "CUSTOM_FIELD_REQUIRED", result.message);
    case "custom_field_invalid":
      throw new ApiError(400, "CUSTOM_FIELD_INVALID", result.message);
  }
}

function tenantError(): ApiError {
  return new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "人物档案不存在或无权访问");
}
