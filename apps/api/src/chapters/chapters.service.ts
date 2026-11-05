import { Injectable } from "@nestjs/common";
import {
  chapterBriefSchema,
  type Chapter,
  type ChapterBrief,
  type ChapterCreateRequest,
  type ChapterPatchRequest,
  type ChapterReadiness,
  type ChapterVersion,
  type ChapterVersionCreateRequest,
  type ChapterVersionSaveData,
  type ChapterWorkspace,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import type { WorksAuditContext } from "../works/works.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ChaptersRepository } from "./chapters.repository";
import type {
  ChapterReadinessSources,
  ChapterRecord,
  ChapterVersionWithParent,
  ChapterWithVersion,
  ChapterWorkContext,
} from "./chapters.repository";

@Injectable()
export class ChaptersService {
  constructor(private readonly repository: ChaptersRepository) {}

  async list(userId: string, workId: string, branchId: string): Promise<ChapterWorkspace[]> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const [records, sources] = await Promise.all([
      this.repository.list(userId, context),
      this.repository.readinessSources(userId, context),
    ]);
    return records.map((record) => this.toWorkspace(record, sources));
  }

  async get(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<ChapterWorkspace> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const [record, sources] = await Promise.all([
      this.repository.find(userId, context, chapterId),
      this.repository.readinessSources(userId, context),
    ]);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    return this.toWorkspace(record, sources);
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: ChapterCreateRequest,
    audit: WorksAuditContext,
  ): Promise<ChapterWorkspace> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const created = await this.repository.create(userId, context, input, audit);
    if (created === "order_exists") {
      throw new ApiError(400, "VALIDATION_INVALID", "该章节序号已经存在");
    }
    const sources = await this.repository.readinessSources(userId, context);
    return this.toWorkspace(
      {
        chapter: created,
        currentVersion: null,
        parentNodeId: null,
      },
      sources,
    );
  }

  async patch(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    input: ChapterPatchRequest,
    audit: WorksAuditContext,
  ): Promise<ChapterWorkspace> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const patched = await this.repository.patch(userId, context, chapterId, input, audit);
    if (patched === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    if (patched === "not_editable") {
      throw new ApiError(409, "VALIDATION_INVALID", "章节当前状态不能修改章纲");
    }
    if (patched === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "章节已被其他操作更新，请刷新后重试");
    }
    const [record, sources] = await Promise.all([
      this.repository.find(userId, context, chapterId),
      this.repository.readinessSources(userId, context),
    ]);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    return this.toWorkspace(record, sources);
  }

  async saveVersion(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    input: ChapterVersionCreateRequest,
    audit: WorksAuditContext,
  ): Promise<ChapterVersionSaveData> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const result = await this.repository.saveVersion(
      userId,
      context,
      chapterId,
      input.version,
      input.content,
      audit,
    );
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    if (result === "not_editable") {
      throw new ApiError(409, "VALIDATION_INVALID", "章节当前状态不能保存新版本");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "章节已被其他操作更新，请刷新后重试");
    }
    const sources = await this.repository.readinessSources(userId, context);
    return {
      chapter: this.toWorkspace(
        {
          chapter: result.chapter,
          currentVersion: result.version,
          parentNodeId: result.version.parentNodeId,
        },
        sources,
      ),
      version: toVersionContract(result.version),
    };
  }

  async versions(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<ChapterVersion[]> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const versions = await this.repository.listVersions(userId, context, chapterId);
    if (!versions) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    return versions.map(toVersionContract);
  }

  async chapterReadiness(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<ChapterReadiness> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const [record, sources] = await Promise.all([
      this.repository.find(userId, context, chapterId),
      this.repository.readinessSources(userId, context),
    ]);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    return chapterReadiness(sources, parseBrief(record.chapter.brief));
  }

  async outlineReadiness(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<ChapterReadiness> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const [records, sources] = await Promise.all([
      this.repository.list(userId, context),
      this.repository.readinessSources(userId, context),
    ]);
    if (records.length === 0) {
      return chapterReadiness(sources, null);
    }
    const hasCompleteBrief = records.some((record) => parseBrief(record.chapter.brief));
    return chapterReadiness(sources, null, hasCompleteBrief);
  }

  private async requireWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<ChapterWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    return context;
  }

  private toWorkspace(
    record: ChapterWithVersion,
    sources: ChapterReadinessSources,
  ): ChapterWorkspace {
    const brief = parseBrief(record.chapter.brief);
    return {
      ...toChapterBase(record.chapter),
      currentVersionId: record.chapter.currentVersionId,
      currentVersion: record.currentVersion
        ? toVersionContract({
            ...record.currentVersion,
            parentNodeId: record.parentNodeId,
          })
        : null,
      brief,
      readiness: chapterReadiness(sources, brief),
      createdAt: record.chapter.createdAt.toISOString(),
      updatedAt: record.chapter.updatedAt.toISOString(),
    };
  }
}

export function chapterReadiness(
  sources: ChapterReadinessSources,
  brief: ChapterBrief | null,
  hasBrief = brief !== null,
): ChapterReadiness {
  const missingSettings = [
    ["world_rule", "世界规则"],
    ["character", "人物"],
    ["golden_finger", "金手指"],
  ]
    .filter(([type]) => !sources.lockedSettingTypes.includes(type!))
    .map(([, label]) => `缺少已确认的${label}`);
  const missingBrief = hasBrief && !brief ? [] : missingBriefFields(brief);
  const items: ChapterReadiness["items"] = [
    {
      key: "story_bible",
      label: "故事圣经",
      ready: sources.storyBibleLocked,
      missing: sources.storyBibleLocked ? [] : ["故事圣经尚未锁定"],
    },
    {
      key: "settings",
      label: "已确认设定",
      ready: missingSettings.length === 0,
      missing: missingSettings,
    },
    {
      key: "brief",
      label: "章纲",
      ready: missingBrief.length === 0,
      missing: missingBrief,
    },
  ];
  const completed = items.filter((item) => item.ready).length;
  return {
    status: completed === items.length ? "ready" : completed === 0 ? "not_ready" : "partial",
    completed,
    total: 3,
    canStartWriting: completed === items.length,
    items,
  };
}

function missingBriefFields(brief: ChapterBrief | null): string[] {
  if (!brief) {
    return ["还没有章纲"];
  }
  const missing: string[] = [];
  if (!brief.goal) {
    missing.push("缺少章目标");
  }
  if (!brief.pov) {
    missing.push("缺少 POV");
  }
  if (!brief.location) {
    missing.push("缺少地点");
  }
  if (brief.sceneBeats.length === 0) {
    missing.push("缺少场景节拍");
  }
  if (brief.requiredFacts.length === 0) {
    missing.push("缺少必用事实");
  }
  return missing;
}

function parseBrief(value: Record<string, unknown>): ChapterBrief | null {
  const parsed = chapterBriefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toChapterBase(chapter: ChapterRecord): Omit<Chapter, "currentVersionId"> {
  return {
    id: chapter.id,
    workId: chapter.workId,
    branchId: chapter.branchId,
    order: chapter.number,
    title: chapter.title,
    status: chapter.status as Chapter["status"],
    version: chapter.version,
    wordCount: chapter.wordCount,
  };
}

function toVersionContract(version: ChapterVersionWithParent): ChapterVersion {
  return {
    id: version.id,
    chapterId: version.chapterId,
    version: version.version,
    content: version.content,
    contentHash: version.contentHash,
    versionNodeId: version.versionNodeId,
    parentNodeId: version.parentNodeId,
    createdAt: version.createdAt.toISOString(),
  };
}
