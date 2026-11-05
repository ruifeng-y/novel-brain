import { Injectable } from "@nestjs/common";
import {
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  type StoryBible,
  type StoryBibleCard,
  type StoryBibleCardKey,
  type StoryBibleLockRequest,
  type StoryBiblePatchRequest,
  type StoryBibleReadiness,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StoryBibleGenerator } from "./story-bible.generator";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StoryBibleRepository } from "./story-bible.repository";
import type {
  StoryBibleAuditContext,
  StoryBibleRecord,
  StoryBibleWorkContext,
} from "./story-bible.repository";

@Injectable()
export class StoryBibleService {
  constructor(
    private readonly repository: StoryBibleRepository,
    private readonly generator: StoryBibleGenerator,
  ) {}

  async get(userId: string, workId: string, branchId: string): Promise<StoryBible> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const record = await this.repository.getOrCreate(
      userId,
      context,
      blankStoryBibleCards(),
      uuidv7(),
    );
    return this.toContract(record);
  }

  async readiness(userId: string, workId: string, branchId: string): Promise<StoryBibleReadiness> {
    return (await this.get(userId, workId, branchId)).readiness;
  }

  async generate(userId: string, workId: string, branchId: string): Promise<StoryBible> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    requireXianxia(context);
    const current = await this.repository.getOrCreate(
      userId,
      context,
      blankStoryBibleCards(),
      uuidv7(),
    );
    if (current.status === "locked") {
      throw new ApiError(409, "BIBLE_LOCKED", "故事圣经已锁定，不能直接重新生成");
    }
    const generatedAt = new Date();
    const updated = await this.repository.updateProposal(
      userId,
      current.id,
      current.version,
      this.generator.generate(context),
      generatedAt,
    );
    if (updated === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "故事圣经不存在或无权访问");
    }
    if (updated === "locked") {
      throw new ApiError(409, "BIBLE_LOCKED", "故事圣经已锁定，不能直接重新生成");
    }
    if (updated === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "故事圣经已被其他操作更新，请刷新后重试");
    }
    return this.toContract(updated);
  }

  async patch(
    userId: string,
    workId: string,
    branchId: string,
    input: StoryBiblePatchRequest,
  ): Promise<StoryBible> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    requireXianxia(context);
    const current = await this.repository.getOrCreate(
      userId,
      context,
      blankStoryBibleCards(),
      uuidv7(),
    );
    if (current.status === "locked") {
      throw new ApiError(409, "BIBLE_LOCKED", "故事圣经已锁定，不能直接编辑");
    }
    if (current.version !== input.version) {
      throw new ApiError(409, "VERSION_CONFLICT", "故事圣经已被其他操作更新，请刷新后重试");
    }

    const updates = new Map(input.cards.map((card) => [card.key, card.content]));
    const cards = current.cards.map((card) => {
      const key = card.key as StoryBibleCardKey;
      const content = updates.get(key);
      if (content === undefined) {
        return card;
      }
      return {
        key,
        title: STORY_BIBLE_CARD_TITLES[key],
        content,
        complete: content.trim().length > 0,
      };
    });

    const updated = await this.repository.updateCards(userId, current.id, current.version, cards);
    if (updated === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "故事圣经不存在或无权访问");
    }
    if (updated === "locked") {
      throw new ApiError(409, "BIBLE_LOCKED", "故事圣经已锁定，不能直接编辑");
    }
    if (updated === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "故事圣经已被其他操作更新，请刷新后重试");
    }
    return this.toContract(updated);
  }

  async lock(
    userId: string,
    workId: string,
    branchId: string,
    input: StoryBibleLockRequest,
    audit: StoryBibleAuditContext,
  ): Promise<StoryBible> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    requireXianxia(context);
    const current = await this.repository.getOrCreate(
      userId,
      context,
      blankStoryBibleCards(),
      uuidv7(),
    );
    if (current.status === "locked") {
      throw new ApiError(409, "BIBLE_LOCKED", "故事圣经已锁定");
    }
    if (current.version !== input.version) {
      throw new ApiError(409, "VERSION_CONFLICT", "故事圣经已被其他操作更新，请刷新后重试");
    }
    const readiness = storyBibleReadiness(
      current.cards as StoryBibleCard[],
      current.status as StoryBible["status"],
    );
    if (readiness.status !== "ready") {
      throw new ApiError(409, "BIBLE_NOT_READY", "故事圣经尚未完整，不能锁定", {
        completed: readiness.completed,
        total: readiness.total,
        missingCards: readiness.missingCards,
      });
    }

    const locked = await this.repository.lock(
      userId,
      current.id,
      current.version,
      readiness,
      audit,
    );
    if (locked === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "故事圣经不存在或无权访问");
    }
    if (locked === "locked") {
      throw new ApiError(409, "BIBLE_LOCKED", "故事圣经已锁定");
    }
    if (locked === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "故事圣经已被其他操作更新，请刷新后重试");
    }
    return this.toContract(locked);
  }

  async rejectDirectDelete(userId: string, workId: string, branchId: string): Promise<never> {
    const storyBible = await this.get(userId, workId, branchId);
    if (storyBible.status === "locked") {
      throw new ApiError(409, "BIBLE_LOCKED", "故事圣经已锁定，不能直接删除卡片");
    }
    throw new ApiError(400, "VALIDATION_INVALID", "故事圣经固定为九卡，不能直接删除卡片");
  }

  private async requireWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<StoryBibleWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    return context;
  }

  private toContract(record: StoryBibleRecord): StoryBible {
    const cards = record.cards as StoryBibleCard[];
    return {
      id: record.id,
      workId: record.workId,
      branchId: record.branchId,
      version: record.version,
      status: record.status as StoryBible["status"],
      cards,
      readiness: storyBibleReadiness(cards, record.status as StoryBible["status"]),
      proposal: record.proposalGeneratedAt
        ? {
            generatedAt: record.proposalGeneratedAt.toISOString(),
            source: "work_premise",
          }
        : null,
      lockedAt: record.lockedAt?.toISOString() ?? null,
      lockedBy: record.lockedBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export function blankStoryBibleCards(): StoryBibleCard[] {
  return STORY_BIBLE_CARD_KEYS.map((key) => ({
    key,
    title: STORY_BIBLE_CARD_TITLES[key],
    content: "",
    complete: false,
  }));
}

export function storyBibleReadiness(
  cards: StoryBibleCard[],
  status: StoryBible["status"],
): StoryBibleReadiness {
  const normalized = STORY_BIBLE_CARD_KEYS.map((key) => {
    const card = cards.find((candidate) => candidate.key === key);
    const content = card?.content.trim() ?? "";
    return {
      key,
      title: STORY_BIBLE_CARD_TITLES[key],
      content,
      complete: content.length > 0,
    };
  });
  const completed = normalized.filter((card) => card.complete).length;
  const missingCards = normalized
    .filter((card) => !card.complete)
    .map(({ key, title }) => ({ key, title }));
  const readinessStatus = completed === 0 ? "not_ready" : completed === 9 ? "ready" : "partial";
  return {
    status: readinessStatus,
    completed,
    total: 9,
    canLock: readinessStatus === "ready" && status !== "locked",
    missingCards,
  };
}

function requireXianxia(context: StoryBibleWorkContext): void {
  if (context.genre !== "xianxia") {
    throw new ApiError(400, "VALIDATION_INVALID", "M0 故事圣经仅支持仙侠题材");
  }
}
