import { Injectable } from "@nestjs/common";
import {
  generationReadinessSchema,
  type ChapterReadiness,
  type GenerationReadiness,
  type GenerationReadinessItem,
  type GenerationReadinessQuery,
  type WorkReadiness,
} from "@novel-brain/contracts";
import { evaluateGenerationReadiness } from "@novel-brain/core";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReadinessRepository } from "./readiness.repository";

@Injectable()
export class ReadinessService {
  constructor(private readonly repository: ReadinessRepository) {}

  async evaluate(
    userId: string,
    workId: string,
    branchId: string,
    query: GenerationReadinessQuery,
  ): Promise<GenerationReadiness> {
    const snapshot = await this.repository.load(userId, workId, branchId, query);
    if (!snapshot) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品、创作线或章节不存在，或无权访问");
    }
    return generationReadinessSchema.parse(evaluateGenerationReadiness(snapshot.input));
  }

  async chapterReadiness(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<ChapterReadiness> {
    return toLegacyChapterReadiness(await this.evaluate(userId, workId, branchId, { chapterId }));
  }

  async outlineReadiness(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<ChapterReadiness> {
    return toLegacyChapterReadiness(await this.evaluate(userId, workId, branchId, {}));
  }

  async workReadiness(userId: string, workId: string, branchId: string): Promise<WorkReadiness> {
    return toLegacyWorkReadiness(await this.evaluate(userId, workId, branchId, {}));
  }
}

export function toLegacyChapterReadiness(readiness: GenerationReadiness): ChapterReadiness {
  const storyBible = itemByKey(readiness, "story_bible");
  const settings = itemByKey(readiness, "settings");
  const worldRules = itemByKey(readiness, "world_rules");
  const risk = itemByKey(readiness, "risk_approval");
  const brief = chapterBriefReady(readiness);

  const settingMissing = [
    ...(!settings?.ready ? [settings?.reason ?? "基础设定尚未就绪"] : []),
    ...(!worldRules?.ready ? [worldRules?.reason ?? "世界规则尚未就绪"] : []),
    ...(!risk?.ready ? [risk?.reason ?? "风险审批尚未完成"] : []),
  ];
  const items: ChapterReadiness["items"] = [
    {
      key: "story_bible",
      label: "故事圣经",
      ready: Boolean(storyBible?.ready),
      missing: storyBible?.ready ? [] : ["故事圣经尚未锁定"],
    },
    {
      key: "settings",
      label: "已确认设定",
      ready: settingMissing.length === 0,
      missing: settingMissing,
    },
    {
      key: "brief",
      label: "章纲",
      ready: brief,
      missing: brief ? [] : ["还没有章纲"],
    },
  ];
  const completed = items.filter((item) => item.ready).length;
  return {
    status: completed === items.length ? "ready" : completed === 0 ? "not_ready" : "partial",
    completed,
    total: 3,
    canStartWriting: readiness.canProceed && brief,
    items,
  };
}

export function toLegacyWorkReadiness(readiness: GenerationReadiness): WorkReadiness {
  const items: WorkReadiness["items"] = [
    {
      key: "main_branch",
      label: "主创作线",
      ready: true,
    },
    {
      key: "model_config",
      label: "模型配置",
      ready: Boolean(itemByKey(readiness, "model_config")?.ready),
    },
    {
      key: "story_bible",
      label: "故事圣经",
      ready: Boolean(itemByKey(readiness, "story_bible")?.ready),
    },
    {
      key: "outline",
      label: "大纲",
      ready: chapterBriefReady(readiness),
    },
  ];
  const completed = items.filter((item) => item.ready).length;
  return {
    status: completed === items.length ? "ready" : completed === 0 ? "not_ready" : "partial",
    completed,
    total: items.length,
    items,
  };
}

function itemByKey(
  readiness: GenerationReadiness,
  key: string,
): GenerationReadinessItem | undefined {
  return readiness.items.find((item) => item.key === key);
}

function chapterBriefReady(readiness: GenerationReadiness): boolean {
  return (
    readiness.items.some((item) => item.key.startsWith("outline:chapter_brief:") && item.ready) ||
    Boolean(itemByKey(readiness, "required_facts")?.ready)
  );
}
