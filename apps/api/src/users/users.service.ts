import { Injectable } from "@nestjs/common";
import type {
  AuthUser,
  AuthorPenName,
  AuthorPenNameCreateRequest,
  AuthorPenNameUpdateRequest,
  ProfileUpdateRequest,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
import { maskEmail } from "../auth/auth-crypto";
import type { PenNameRecord, ProfileAuditContext, UserProfileRecord } from "./users.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersRepository } from "./users.repository";

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async updateProfile(
    userId: string,
    input: ProfileUpdateRequest,
    audit: ProfileAuditContext,
  ): Promise<AuthUser> {
    const user = await this.repository.updateProfile(
      userId,
      input.version,
      {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
      audit,
    );
    if (!user) {
      throw new ApiError(409, "VERSION_CONFLICT", "账号资料已被其他操作更新，请刷新后重试");
    }
    return toProfileContract(user);
  }

  async listPenNames(userId: string): Promise<AuthorPenName[]> {
    return (await this.repository.listPenNames(userId)).map(toPenNameContract);
  }

  async createPenName(
    userId: string,
    input: AuthorPenNameCreateRequest,
    audit: ProfileAuditContext,
  ): Promise<AuthorPenName> {
    try {
      const penName = await this.repository.createPenName({
        id: uuidv7(),
        userId,
        name: input.name,
        bio: input.bio,
        avatarUrl: input.avatarUrl ?? null,
        isDefault: input.isDefault,
        audit,
      });
      return toPenNameContract(penName);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(400, "VALIDATION_INVALID", "这个笔名已经存在");
      }
      throw error;
    }
  }

  async updatePenName(
    userId: string,
    penNameId: string,
    input: AuthorPenNameUpdateRequest,
    audit: ProfileAuditContext,
  ): Promise<AuthorPenName> {
    const result = await this.repository.updatePenName({
      userId,
      penNameId,
      version: input.version,
      values: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
      audit,
    });
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "笔名不存在或无权访问");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "笔名已被其他操作更新，请刷新后重试");
    }
    if (result === "last_default") {
      throw new ApiError(400, "VALIDATION_INVALID", "至少保留一个默认笔名");
    }
    return toPenNameContract(result);
  }

  async deletePenName(
    userId: string,
    penNameId: string,
    audit: ProfileAuditContext,
  ): Promise<void> {
    const result = await this.repository.deletePenName(userId, penNameId, audit);
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "笔名不存在或无权访问");
    }
  }
}

export function toProfileContract(user: UserProfileRecord): AuthUser {
  return {
    id: user.id,
    emailMasked: maskEmail(user.email),
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    version: user.version,
    createdAt: user.createdAt.toISOString(),
  };
}

function toPenNameContract(penName: PenNameRecord): AuthorPenName {
  return {
    id: penName.id,
    name: penName.name,
    bio: penName.bio,
    avatarUrl: penName.avatarUrl,
    isDefault: penName.isDefault,
    version: penName.version,
    createdAt: penName.createdAt.toISOString(),
    updatedAt: penName.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
