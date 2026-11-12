import { Injectable } from "@nestjs/common";
import {
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  genrePackGenerationGuidanceSchema,
  type StoryBible,
  type StoryBibleCard,
  type StoryBibleCardKey,
  type StoryBibleChangeRequest,
  type StoryBibleChangeRequestCreateRequest,
  type StoryBibleIssue,
  type StoryBibleLockRequest,
  type StoryBiblePatchRequest,
  type StoryBibleReadiness,
  type StoryBibleUnlockRequest,
  type StoryBibleVersion,
  type StoryBibleVersionListQuery,
  type StoryBibleWorldRule,
  type StoryBibleWorldRuleListQuery,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
import { invalidCursorError } from "../common/cursor-page";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StoryBibleGenerator } from "./story-bible.generator";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StoryBibleRepository } from "./story-bible.repository";
import type {
  StoryBibleAuditContext,
  StoryBibleChangeRequestRecord,
  StoryBibleRecord,
  StoryBibleVersionRecord,
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

  async versions(
    userId: string,
    workId: string,
    branchId: string,
    query: StoryBibleVersionListQuery,
  ): Promise<{ versions: StoryBibleVersion[]; nextCursor: string | null }> {
    const storyBible = await this.get(userId, workId, branchId);
    const result = await this.repository.listVersions(userId, storyBible.id, query);
    if (result === "invalid_cursor") {
      throw invalidCursorError();
    }
    return {
      versions: result.versions.map((version) => this.toVersionContract(version)),
      nextCursor: result.nextCursor,
    };
  }

  async worldRules(
    userId: string,
    workId: string,
    branchId: string,
    query: StoryBibleWorldRuleListQuery,
  ): Promise<{ worldRules: StoryBibleWorldRule[]; nextCursor: string | null }> {
    const storyBible = await this.get(userId, workId, branchId);
    const result = await this.repository.listWorldRules(userId, storyBible.id, query);
    if (result === "invalid_cursor") {
      throw invalidCursorError();
    }
    return {
      worldRules: result.worldRules,
      nextCursor: result.nextCursor,
    };
  }

  async generate(
    userId: string,
    workId: string,
    branchId: string,
    audit: StoryBibleAuditContext,
  ): Promise<StoryBible> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const current = await this.repository.getOrCreate(
      userId,
      context,
      blankStoryBibleCards(),
      uuidv7(),
    );
    const cards = this.generator.generate(context);
    const updated = await this.repository.appendVersion({
      userId,
      storyBibleId: current.id,
      expectedVersion: current.version,
      cards,
      status: "proposed",
      action: "proposed",
      reason: "生成九卡提案",
      readiness: storyBibleReadiness(cards, "proposed"),
      proposalGeneratedAt: new Date(),
      audit,
    });
    return this.handleVersionResult(updated, "故事圣经已锁定，不能直接重新生成");
  }

  async patch(
    userId: string,
    workId: string,
    branchId: string,
    input: StoryBiblePatchRequest,
    audit: StoryBibleAuditContext,
  ): Promise<StoryBible> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const current = await this.repository.getOrCreate(
      userId,
      context,
      blankStoryBibleCards(),
      uuidv7(),
    );
    if (current.version !== input.version) {
      throw versionConflict();
    }
    const cards = applyCardUpdates(current.cards as StoryBibleCard[], input.cards);
    assertGenreLanguage(
      context,
      input.cards.map((card) => ({
        key: card.key,
        title: STORY_BIBLE_CARD_TITLES[card.key],
        content: card.content,
        complete: true,
        worldRules: card.worldRules ?? [],
      })),
    );
    const updated = await this.repository.appendVersion({
      userId,
      storyBibleId: current.id,
      expectedVersion: input.version,
      cards,
      status: current.status === "proposed" ? "proposed" : "draft",
      action: "edited",
      reason: input.reason,
      readiness: storyBibleReadiness(cards, current.status as StoryBible["status"]),
      audit,
    });
    return this.handleVersionResult(updated, "故事圣经已锁定，不能直接编辑");
  }

  async lock(
    userId: string,
    workId: string,
    branchId: string,
    input: StoryBibleLockRequest,
    audit: StoryBibleAuditContext,
  ): Promise<StoryBible> {
    const context = await this.requireWorkContext(userId, workId, branchId);
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
      throw versionConflict();
    }
    const readiness = storyBibleReadiness(
      current.cards as StoryBibleCard[],
      current.status as StoryBible["status"],
    );
    if (readiness.status !== "ready") {
      throw new ApiError(409, "BIBLE_NOT_READY", "故事圣经尚未完整或存在冲突，不能锁定", {
        completed: readiness.completed,
        total: readiness.total,
        missingCards: readiness.missingCards,
        issues: readiness.issues,
      });
    }

    const locked = await this.repository.appendVersion({
      userId,
      storyBibleId: current.id,
      expectedVersion: current.version,
      cards: current.cards as StoryBibleCard[],
      status: "locked",
      action: "locked",
      reason: "锁定故事圣经",
      readiness,
      audit,
    });
    return this.handleVersionResult(locked, "故事圣经已锁定");
  }

  async unlock(
    userId: string,
    workId: string,
    branchId: string,
    input: StoryBibleUnlockRequest,
    audit: StoryBibleAuditContext,
  ): Promise<StoryBible> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const current = await this.repository.getOrCreate(
      userId,
      context,
      blankStoryBibleCards(),
      uuidv7(),
    );
    if (current.status !== "locked") {
      throw new ApiError(409, "BIBLE_NOT_LOCKED", "故事圣经尚未锁定，不能解锁");
    }
    if (current.version !== input.version) {
      throw versionConflict();
    }
    const cards = current.cards as StoryBibleCard[];
    const unlocked = await this.repository.appendVersion({
      userId,
      storyBibleId: current.id,
      expectedVersion: current.version,
      cards,
      status: "draft",
      action: "unlocked",
      reason: input.reason,
      readiness: storyBibleReadiness(cards, "draft"),
      requireLocked: true,
      audit,
    });
    return this.handleVersionResult(unlocked, "故事圣经尚未锁定，不能解锁");
  }

  async createChangeRequest(
    userId: string,
    workId: string,
    branchId: string,
    input: StoryBibleChangeRequestCreateRequest,
    audit: StoryBibleAuditContext,
    idempotencyKey?: string,
  ): Promise<StoryBibleChangeRequest> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const current = await this.repository.getOrCreate(
      userId,
      context,
      blankStoryBibleCards(),
      uuidv7(),
    );
    if (current.status !== "locked") {
      throw new ApiError(409, "BIBLE_NOT_LOCKED", "只有锁定后的故事圣经需要发起修改请求");
    }
    if (current.version !== input.version) {
      throw versionConflict();
    }
    const before = (current.cards as StoryBibleCard[]).find((card) => card.key === input.cardKey);
    if (!before) {
      throw new ApiError(400, "VALIDATION_INVALID", "故事圣经卡片不存在");
    }
    assertGenreLanguage(context, [normalizeCard(input.after)]);
    const request = await this.repository.createChangeRequest({
      userId,
      storyBibleId: current.id,
      expectedVersion: input.version,
      workId: current.workId,
      branchId: current.branchId,
      cardKey: input.cardKey,
      title: input.title,
      reason: input.reason,
      before: normalizeCard(before),
      after: normalizeCard(input.after),
      audit,
      idempotencyKey: idempotencyKey ?? null,
    });
    if (request === "not_locked") {
      throw new ApiError(409, "BIBLE_NOT_LOCKED", "只有锁定后的故事圣经需要发起修改请求");
    }
    if (request === "version_conflict") {
      throw versionConflict();
    }
    return this.toChangeRequestContract(request);
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

  private handleVersionResult(
    result: "not_found" | "locked" | "not_locked" | "version_conflict" | StoryBibleRecord,
    lockedMessage: string,
  ): StoryBible {
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "故事圣经不存在或无权访问");
    }
    if (result === "locked") {
      throw new ApiError(409, "BIBLE_LOCKED", lockedMessage);
    }
    if (result === "not_locked") {
      throw new ApiError(409, "BIBLE_NOT_LOCKED", "故事圣经尚未锁定");
    }
    if (result === "version_conflict") {
      throw versionConflict();
    }
    return this.toContract(result);
  }

  private toContract(record: StoryBibleRecord): StoryBible {
    const cards = normalizeCards(record.cards as StoryBibleCard[]);
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

  private toVersionContract(record: StoryBibleVersionRecord): StoryBibleVersion {
    return {
      id: record.id,
      storyBibleId: record.storyBibleId,
      workId: record.workId,
      branchId: record.branchId,
      version: record.version,
      action: record.action as StoryBibleVersion["action"],
      actorId: record.createdBy,
      reason: record.reason,
      cards: normalizeCards(record.cards as StoryBibleCard[]),
      createdAt: record.createdAt.toISOString(),
    };
  }

  private toChangeRequestContract(record: StoryBibleChangeRequestRecord): StoryBibleChangeRequest {
    return {
      id: record.id,
      storyBibleId: record.storyBibleId,
      workId: record.workId,
      branchId: record.branchId,
      cardKey: record.cardKey as StoryBibleChangeRequest["cardKey"],
      title: record.title,
      reason: record.reason,
      before: normalizeCard(record.before as StoryBibleCard),
      after: normalizeCard(record.after as StoryBibleCard),
      status: record.status as StoryBibleChangeRequest["status"],
      risk: record.risk as StoryBibleChangeRequest["risk"],
      source: record.source as StoryBibleChangeRequest["source"],
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

export function blankStoryBibleCards(): StoryBibleCard[] {
  return STORY_BIBLE_CARD_KEYS.map((key) => ({
    key,
    title: STORY_BIBLE_CARD_TITLES[key],
    content: "",
    complete: false,
    worldRules: [],
  }));
}

export function storyBibleReadiness(
  cards: StoryBibleCard[],
  status: StoryBible["status"],
): StoryBibleReadiness {
  const normalized = normalizeCards(cards).map((card) => {
    const content = card.content.trim();
    const complete =
      card.key === "worldLaws"
        ? content.length > 0 && card.worldRules.length > 0
        : content.length > 0;
    return { ...card, content, complete };
  });
  const completed = normalized.filter((card) => card.complete).length;
  const missingCards = normalized
    .filter((card) => !card.complete)
    .map(({ key, title }) => ({ key, title }));
  const issues: StoryBibleIssue[] = missingCards.map((card) => ({
    code: "missing_card",
    key: card.key,
    title: card.title,
    message: `${card.title}尚未填写完整。`,
  }));
  const worldLaws = normalized.find((card) => card.key === "worldLaws");
  if (worldLaws && worldLaws.content.length > 0 && worldLaws.worldRules.length === 0) {
    issues.push({
      code: "missing_world_rule",
      key: "worldLaws",
      title: STORY_BIBLE_CARD_TITLES.worldLaws,
      message: "世界铁律卡片需要至少一条结构化规则。",
    });
  }
  const ruleNames = new Set<string>();
  for (const rule of worldLaws?.worldRules ?? []) {
    if (ruleNames.has(rule.name)) {
      issues.push({
        code: "contradictory_world_rule",
        key: "worldLaws",
        title: STORY_BIBLE_CARD_TITLES.worldLaws,
        message: `世界铁律存在同名规则“${rule.name}”，请合并或改名后再锁定。`,
      });
      break;
    }
    ruleNames.add(rule.name);
  }
  const readinessStatus =
    completed === 0 ? "not_ready" : completed === 9 && issues.length === 0 ? "ready" : "partial";
  return {
    status: readinessStatus,
    completed,
    total: 9,
    canLock: readinessStatus === "ready" && status !== "locked",
    missingCards,
    issues,
  };
}

function applyCardUpdates(
  currentCards: StoryBibleCard[],
  updates: StoryBiblePatchRequest["cards"],
): StoryBibleCard[] {
  const updatesByKey = new Map(updates.map((card) => [card.key, card]));
  return normalizeCards(currentCards).map((card) => {
    const update = updatesByKey.get(card.key);
    if (!update) {
      return card;
    }
    return normalizeCard({
      key: card.key,
      title: STORY_BIBLE_CARD_TITLES[card.key],
      content: update.content,
      complete: update.content.trim().length > 0,
      worldRules:
        update.worldRules?.map((rule) => ({
          ...rule,
          id: rule.id ?? uuidv7(),
        })) ?? card.worldRules,
    });
  });
}

function normalizeCards(cards: StoryBibleCard[]): StoryBibleCard[] {
  return STORY_BIBLE_CARD_KEYS.map((key) => {
    const card = cards.find((candidate) => candidate.key === key);
    return normalizeCard({
      key,
      title: STORY_BIBLE_CARD_TITLES[key],
      content: card?.content ?? "",
      complete: card?.complete ?? false,
      worldRules: key === "worldLaws" ? (card?.worldRules ?? []) : [],
    });
  });
}

function normalizeCard(card: StoryBibleCard): StoryBibleCard {
  return {
    key: card.key,
    title: STORY_BIBLE_CARD_TITLES[card.key as StoryBibleCardKey],
    content: card.content,
    complete: card.content.trim().length > 0,
    worldRules: card.key === "worldLaws" ? (card.worldRules ?? []) : [],
  };
}

function versionConflict(): ApiError {
  return new ApiError(409, "VERSION_CONFLICT", "故事圣经已被其他操作更新，请刷新后重试");
}

function assertGenreLanguage(
  context: StoryBibleWorkContext,
  cards: Array<{ title: string; content: string }>,
): void {
  const guidance = genrePackGenerationGuidanceSchema.safeParse(context.generationGuidance);
  if (!guidance.success || guidance.data.forbiddenElements.length === 0) {
    return;
  }
  const content = cards.map((card) => `${card.title}\n${card.content}`).join("\n");
  const violations = guidance.data.forbiddenElements.filter((term) => content.includes(term));
  if (violations.length > 0) {
    throw new ApiError(
      400,
      "VALIDATION_INVALID",
      `当前题材不能使用这些术语：${violations.join("、")}`,
      { violations },
    );
  }
}
