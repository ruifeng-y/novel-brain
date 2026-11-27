import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  genrePackDefinitionSchema,
  type GenrePackDefinition,
  type GenrePackListQuery,
  type GenrePackVersionChangeRequest,
  type ImportCandidateType,
  type Work,
  type WorkBranch,
  type WorkBranchListQuery,
  type WorkCreateRequest,
  type WorkDuplicateRequest,
  type WorkLifecycleRequest,
  type WorkListItem,
  type WorkListQuery,
  type WorkOverview,
  type WorkPurgeResponse,
  type WorkTrashResponse,
  type WorkUpdateRequest,
  type SettingsImportConfirmRequest,
} from "@novel-brain/contracts";
import { OBJECT_STORAGE, type ObjectStorage } from "@novel-brain/storage";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
import { BlueprintService } from "../blueprints/blueprint.service";
import { invalidCursorError, type CursorPageResult } from "../common/cursor-page";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReadinessService } from "../readiness/readiness.service";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksRepository } from "./works.repository";
import type {
  WorkBranchRecord,
  WorkListRow,
  WorkRecord,
  WorksAuditContext,
  WorkUpdateValues,
} from "./works.repository";
import type { InitialSettingEntity } from "./works.repository";
import type { GenrePackRecord } from "./works.repository";

export interface WorkCoverUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Injectable()
export class WorksService {
  constructor(
    private readonly repository: WorksRepository,
    private readonly readiness: ReadinessService,
    private readonly blueprints: BlueprintService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(
    userId: string,
    displayName: string,
    input: WorkCreateRequest,
    audit: WorksAuditContext,
    idempotencyKey?: string,
  ): Promise<WorkOverview> {
    if (idempotencyKey) {
      const existing = await this.repository.findByIdempotencyKey(userId, idempotencyKey);
      if (existing) {
        const branch = (await this.repository.findBranches(userId, existing.id)).find(
          (candidate) => candidate.name === "main",
        );
        if (branch) {
          await this.blueprints.retryQueuedDelivery(userId, existing.id, branch.id);
        }
        return this.toOverview(userId, existing);
      }
    }

    if (input.mode === "template" && input.templateKey !== input.genre) {
      throw new ApiError(400, "VALIDATION_INVALID", "题材模板与作品题材必须一致");
    }
    const templatePack = await this.repository.findLatestGenrePack(input.genre);
    if (!templatePack) {
      throw new ApiError(400, "VALIDATION_INVALID", "题材模板不可用");
    }

    const workId = uuidv7();
    const branchId = uuidv7();
    const nodeId = uuidv7();
    const blueprint =
      input.mode === "idea"
        ? await this.blueprints.prepareForIdea({
            userId,
            workId,
            branchId,
            title: input.title,
            idea: input.idea,
            genre: input.genre,
            scaleTarget: input.scaleTarget,
            chapterLengthTarget: input.chapterLengthTarget,
            templatePackId: templatePack.id,
            ...(input.blueprintBudget ? { budgetOverride: input.blueprintBudget } : {}),
          })
        : undefined;

    const created = await this.repository.create({
      id: workId,
      branchId,
      nodeId,
      userId,
      title: input.title,
      penName: input.penName ?? displayName,
      genre: input.genre,
      scaleTarget: input.scaleTarget,
      chapterLengthTarget: input.chapterLengthTarget,
      sourceMode: input.mode,
      idea: input.mode === "idea" ? input.idea : null,
      templatePackId: templatePack.id,
      settings: { genrePack: genrePackSettings(templatePack) },
      ...(blueprint ? { blueprint } : {}),
      idempotencyKey: idempotencyKey ?? null,
      audit,
    });
    if (blueprint && created.wasCreated) {
      await this.blueprints.enqueueSafely(blueprint.jobPayload);
    } else if (!created.wasCreated) {
      await this.blueprints.retryQueuedDelivery(userId, created.work.id, created.branch.id);
    }
    return this.toOverview(userId, created.work, created.branch, templatePack);
  }

  async list(
    userId: string,
    query: WorkListQuery,
  ): Promise<{ works: WorkListItem[]; nextCursor: string | null }> {
    const result = await this.repository.list(userId, query);
    if (result === "invalid_cursor") {
      throw invalidCursorError();
    }
    const packs = await this.repository.findGenrePacksByIds(
      result.works.flatMap((row) => (row.work.templatePackId ? [row.work.templatePackId] : [])),
    );
    const exportReadyIds = await this.repository.exportReadyWorkIds(
      userId,
      result.works.flatMap((row) => (row.work.deletedAt ? [row.work.id] : [])),
    );
    const packById = new Map(packs.map((pack) => [pack.id, pack]));
    return {
      works: result.works.map((row) =>
        this.toListContract(
          row,
          row.work.templatePackId ? packById.get(row.work.templatePackId) : undefined,
          exportReadyIds.has(row.work.id),
        ),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async createFromSettingsImport(
    userId: string,
    displayName: string,
    importId: string,
    input: SettingsImportConfirmRequest,
    audit: WorksAuditContext,
    idempotencyKey: string,
    candidates: ImportedSettingCandidate[] = [],
  ): Promise<WorkOverview> {
    const initialSettingEntities = candidates.map(toInitialSettingEntity);
    const templatePack = await this.repository.findLatestGenrePack(input.genre);
    if (!templatePack) {
      throw new ApiError(400, "VALIDATION_INVALID", "题材模板不可用");
    }
    const created = await this.repository.create({
      id: uuidv7(),
      branchId: uuidv7(),
      nodeId: uuidv7(),
      userId,
      title: input.title,
      penName: input.penName ?? displayName,
      genre: input.genre,
      scaleTarget: input.scaleTarget,
      chapterLengthTarget: input.chapterLengthTarget,
      sourceMode: "settings_import",
      idea: null,
      templatePackId: templatePack.id,
      settings: {
        importId,
        materializedSettingCount: initialSettingEntities.length,
        genrePack: genrePackSettings(templatePack),
      },
      initialSettingEntities,
      idempotencyKey,
      audit,
    });
    return this.toOverview(userId, created.work, created.branch, templatePack);
  }

  async listGenrePacks(query: GenrePackListQuery): Promise<GenrePackDefinition[]> {
    const packs = await this.repository.listGenrePacks(query.key);
    return packs.map(toGenrePackContract);
  }

  async changeGenrePackVersion(
    userId: string,
    workId: string,
    input: GenrePackVersionChangeRequest,
    audit: WorksAuditContext,
    idempotencyKey: string,
  ): Promise<WorkOverview> {
    if (!idempotencyKey.trim()) {
      throw new ApiError(400, "VALIDATION_INVALID", "调整题材包需要 Idempotency-Key");
    }
    const result = await this.repository.changeGenrePackVersion({
      userId,
      workId,
      targetVersion: input.targetVersion,
      reason: input.reason,
      idempotencyKey: idempotencyKey.trim(),
      audit,
    });
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    if (result === "pack_not_found") {
      throw new ApiError(400, "GENRE_PACK_VERSION_NOT_FOUND", "题材包版本不存在");
    }
    if (result === "idempotency_conflict") {
      throw new ApiError(
        409,
        "GENRE_PACK_IDEMPOTENCY_CONFLICT",
        "同一 Idempotency-Key 不能用于不同的题材包版本请求",
      );
    }
    return this.toOverview(userId, result.work, undefined, result.pack);
  }

  async get(userId: string, workId: string, branchId?: string): Promise<WorkOverview> {
    const work = await this.repository.find(userId, workId);
    if (!work) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    return this.toOverview(userId, work, undefined, undefined, branchId);
  }

  async branches(
    userId: string,
    workId: string,
    query: WorkBranchListQuery,
  ): Promise<CursorPageResult<WorkBranch>> {
    const work = await this.repository.find(userId, workId);
    if (!work) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    const page = await this.repository.listBranches(userId, workId, query);
    if (page === "invalid_cursor") {
      throw invalidCursorError();
    }
    return {
      data: page.data.map((branch) => this.toBranchContract(branch)),
      nextCursor: page.nextCursor,
    };
  }

  async update(
    userId: string,
    workId: string,
    input: WorkUpdateRequest,
    audit: WorksAuditContext,
  ): Promise<WorkOverview> {
    const current = await this.repository.find(userId, workId);
    if (!current) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    if (
      current.status === "completed" &&
      (input.status === undefined || input.status === "completed")
    ) {
      throw new ApiError(409, "VERSION_CONFLICT", "作品已完本，请先恢复连载再修改");
    }
    if (current.status === "archived") {
      throw new ApiError(409, "VERSION_CONFLICT", "作品已归档，请先恢复后再修改");
    }
    const values: WorkUpdateValues = {};
    if (input.title !== undefined) values.title = input.title;
    if (input.penName !== undefined) values.penName = input.penName;
    if (input.genre !== undefined) values.genre = input.genre;
    if (input.status !== undefined) values.status = input.status;
    if (input.scaleTarget !== undefined) values.scaleTarget = input.scaleTarget;
    if (input.chapterLengthTarget !== undefined) {
      values.chapterLengthTarget = input.chapterLengthTarget;
    }
    if (input.coverImageUrl !== undefined) values.coverImageUrl = input.coverImageUrl;
    if (input.tags !== undefined) values.tags = input.tags;
    if (input.settings) {
      values.settings = { ...current.settings, ...input.settings };
    }
    const updated = await this.repository.update(userId, workId, input.version, values, audit);
    if (!updated) {
      throw new ApiError(409, "VERSION_CONFLICT", "作品设置已被其他操作更新，请刷新后重试");
    }
    if (input.coverImageUrl !== undefined && current.coverObjectKey) {
      await this.storage.deleteObject(current.coverObjectKey).catch(() => undefined);
    }
    return this.toOverview(userId, updated);
  }

  async archive(
    userId: string,
    workId: string,
    input: WorkLifecycleRequest,
    audit: WorksAuditContext,
  ): Promise<WorkOverview> {
    const current = await this.repository.find(userId, workId);
    if (!current) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    const work = await this.repository.archive(userId, workId, input.version, audit);
    if (!work) {
      throw new ApiError(409, "VERSION_CONFLICT", "作品状态已变化，请刷新后重试");
    }
    return this.toOverview(userId, work);
  }

  async restore(
    userId: string,
    workId: string,
    input: WorkLifecycleRequest,
    audit: WorksAuditContext,
  ): Promise<WorkOverview> {
    const current = await this.repository.find(userId, workId);
    if (!current) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    const work = await this.repository.restore(userId, workId, input.version, audit);
    if (!work) {
      throw new ApiError(409, "VERSION_CONFLICT", "作品状态已变化，请刷新后重试");
    }
    return this.toOverview(userId, work);
  }

  async duplicate(
    userId: string,
    workId: string,
    input: WorkDuplicateRequest,
    audit: WorksAuditContext,
    idempotencyKey: string | undefined,
  ): Promise<WorkOverview> {
    const key = idempotencyKey?.trim() ?? "";
    if (!key) {
      throw new ApiError(400, "VALIDATION_INVALID", "复制作品需要 Idempotency-Key");
    }
    if (key.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "Idempotency-Key 不能超过 200 个字符");
    }
    const source = await this.repository.find(userId, workId);
    if (!source) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    const suffix = "（副本）";
    const requestedTitle = input.title ?? `${source.title.slice(0, 120 - suffix.length)}${suffix}`;
    const duplicated = await this.repository.duplicate({
      userId,
      source,
      title: requestedTitle,
      copyManuscript: input.copyManuscript,
      copyHistory: input.copyHistory,
      workId: uuidv7(),
      branchId: uuidv7(),
      nodeId: uuidv7(),
      audit,
      idempotencyKey: key,
      requestHash: createHash("sha256")
        .update(
          JSON.stringify({
            title: input.title ?? null,
            copyManuscript: input.copyManuscript,
            copyHistory: input.copyHistory,
          }),
        )
        .digest("hex"),
    });
    if (duplicated.status === "conflict") {
      throw new ApiError(
        409,
        "WORK_IDEMPOTENCY_CONFLICT",
        "同一 Idempotency-Key 不能提交不同的复制请求",
      );
    }
    return this.toOverview(userId, duplicated.work, duplicated.branch);
  }

  async trash(
    userId: string,
    workId: string,
    input: WorkLifecycleRequest,
    audit: WorksAuditContext,
  ): Promise<WorkTrashResponse["data"]> {
    const current = await this.repository.find(userId, workId);
    if (!current) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    const work = await this.repository.trash(userId, workId, input.version, audit);
    if (!work?.deletedAt || !work.purgeAfter) {
      throw new ApiError(409, "VERSION_CONFLICT", "作品状态已变化，请刷新后重试");
    }
    return {
      id: work.id,
      deletedAt: work.deletedAt.toISOString(),
      purgeAfter: work.purgeAfter.toISOString(),
      version: work.version,
    };
  }

  async restoreTrash(
    userId: string,
    workId: string,
    input: WorkLifecycleRequest,
    audit: WorksAuditContext,
  ): Promise<WorkOverview> {
    const result = await this.repository.restoreTrashed(userId, workId, input.version, audit);
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    if (result === "expired") {
      throw new ApiError(409, "VERSION_CONFLICT", "回收站保留期已过，作品不能恢复");
    }
    return this.toOverview(userId, result);
  }

  async purge(
    userId: string,
    workId: string,
    input: WorkLifecycleRequest,
    audit: WorksAuditContext,
  ): Promise<WorkPurgeResponse["data"]> {
    const preview = await this.repository.preparePurge(userId, workId, input.version);
    if (preview.status === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    if (preview.status === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "作品状态已变化，请刷新后重试");
    }
    if (preview.status === "not_due") {
      throw new ApiError(409, "WORK_PURGE_NOT_DUE", "作品仍在 30 天回收站保留期内");
    }
    if (preview.status === "export_required") {
      throw new ApiError(409, "WORK_EXPORT_REQUIRED", "永久删除前必须完成作品导出");
    }
    await this.storage.deleteObjects(preview.objectKeys);
    const purged = await this.repository.purge(userId, workId, input.version, audit);
    if (!purged) {
      throw new ApiError(409, "VERSION_CONFLICT", "作品状态已变化，请刷新后重试");
    }
    return { id: workId, deleted: true };
  }

  async uploadCover(
    userId: string,
    workId: string,
    input: WorkLifecycleRequest,
    file: WorkCoverUpload | undefined,
    audit: WorksAuditContext,
  ): Promise<WorkOverview> {
    if (!file || file.size === 0) {
      throw new ApiError(400, "WORK_COVER_INVALID", "请选择有效的封面图片");
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      throw new ApiError(400, "WORK_COVER_INVALID", "封面仅支持 JPEG、PNG 或 WebP");
    }
    let bytes: Buffer;
    try {
      const metadata = await sharp(file.buffer, { failOn: "error" }).metadata();
      if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
        throw new Error("unsupported image format");
      }
      bytes = await sharp(file.buffer, { failOn: "error" })
        .rotate()
        .resize({ width: 1200, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new ApiError(400, "WORK_COVER_INVALID", "封面图片损坏或格式不受支持");
    }
    const objectKey = `covers/${userId}/${workId}/${uuidv7()}.webp`;
    await this.storage.putObject({ key: objectKey, bytes, contentType: "image/webp" });
    const updated = await this.repository.setCoverObject(
      userId,
      workId,
      input.version,
      objectKey,
      audit,
    );
    if (!updated) {
      await this.storage.deleteObject(objectKey).catch(() => undefined);
      throw new ApiError(409, "VERSION_CONFLICT", "作品状态已变化，请刷新后重试");
    }
    if (updated.previousObjectKey && updated.previousObjectKey !== objectKey) {
      await this.storage.deleteObject(updated.previousObjectKey).catch(() => undefined);
    }
    return this.toOverview(userId, updated.work);
  }

  async cover(
    userId: string,
    workId: string,
  ): Promise<{ bytes: Uint8Array; contentType: "image/webp" }> {
    const objectKey = await this.repository.getCoverObjectKey(userId, workId);
    if (!objectKey) {
      throw new ApiError(404, "WORK_COVER_NOT_FOUND", "作品封面不存在");
    }
    return {
      bytes: await this.storage.getObject(objectKey),
      contentType: "image/webp",
    };
  }

  private async toOverview(
    userId: string,
    work: WorkRecord,
    suppliedBranch?: WorkBranchRecord,
    suppliedTemplatePack?: GenrePackRecord,
    requestedBranchId?: string,
  ): Promise<WorkOverview> {
    const branches = suppliedBranch
      ? [suppliedBranch]
      : await this.repository.findBranches(userId, work.id);
    const mainBranch = requestedBranchId
      ? branches.find((branch) => branch.id === requestedBranchId)
      : branches.find((branch) => branch.name === "main");
    if (!mainBranch?.headNodeId) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "创作线不存在或无权访问");
    }
    const readiness = await this.readiness.workReadiness(userId, work.id, mainBranch.id);
    const templatePack =
      suppliedTemplatePack ??
      (work.templatePackId
        ? (await this.repository.findGenrePacksByIds([work.templatePackId]))[0]
        : undefined);
    return {
      ...this.toContract(work, templatePack),
      mainBranch: this.toBranchContract(mainBranch),
      branches: branches.map((branch) => this.toBranchContract(branch)),
      readiness,
    };
  }

  private toContract(
    work: WorkRecord,
    templatePack?: GenrePackRecord,
    hasCompletedExport = false,
  ): Work {
    const exportReady = hasCompletedExport;
    const purgeDue = Boolean(
      work.deletedAt && work.purgeAfter && work.purgeAfter.getTime() <= Date.now(),
    );
    return {
      id: work.id,
      title: work.title,
      penName: work.penName,
      genre: work.genre as Work["genre"],
      status: work.status as Work["status"],
      scaleTarget: work.scaleTarget as Work["scaleTarget"],
      chapterLengthTarget: work.chapterLengthTarget,
      sourceMode: work.sourceMode as Work["sourceMode"],
      idea: work.idea,
      templatePack: templatePack ? toGenrePackContract(templatePack) : null,
      settings: work.settings,
      coverImageUrl: work.coverObjectKey ? `/api/v1/works/${work.id}/cover` : work.coverImageUrl,
      tags: work.tags,
      version: work.version,
      archivedAt: work.archivedAt?.toISOString() ?? null,
      deletedAt: work.deletedAt?.toISOString() ?? null,
      purgeAfter: work.purgeAfter?.toISOString() ?? null,
      exportReady,
      canPurge: purgeDue && exportReady,
      createdAt: work.createdAt.toISOString(),
      updatedAt: work.updatedAt.toISOString(),
    };
  }

  private toListContract(
    row: WorkListRow,
    templatePack?: GenrePackRecord,
    hasCompletedExport = false,
  ): WorkListItem {
    return {
      ...this.toContract(row.work, templatePack, hasCompletedExport),
      metrics: {
        ...row.metrics,
        lastEditedAt: row.metrics.lastEditedAt.toISOString(),
      },
    };
  }

  private toBranchContract(branch: WorkBranchRecord): WorkBranch {
    if (!branch.headNodeId) {
      throw new Error("Branch is missing its head node");
    }
    return {
      id: branch.id,
      workId: branch.workId,
      name: branch.name,
      headNodeId: branch.headNodeId,
      status: branch.status as WorkBranch["status"],
    };
  }
}

function toGenrePackContract(pack: GenrePackRecord): GenrePackDefinition {
  return genrePackDefinitionSchema.parse({
    id: pack.id,
    key: pack.key,
    version: pack.version,
    label: pack.label,
    fields: pack.fields,
    fieldSchema: deriveFieldSchema(pack.fields),
    rules: pack.rules.length > 0 ? pack.rules : defaultGenreRules(pack.key),
    uiHints: normalizeUiHints(pack.key, pack.uiHints),
    generationGuidance: normalizeGenerationGuidance(pack.key, pack.generationGuidance),
    migration: pack.migration,
  });
}

function normalizeUiHints(key: string, value: Record<string, unknown>) {
  if (
    typeof value.worldLabel === "string" &&
    typeof value.powerSystemLabel === "string" &&
    typeof value.powerLevelLabel === "string" &&
    typeof value.factionLabel === "string" &&
    typeof value.itemLabel === "string"
  ) {
    return value;
  }
  if (key === "history") {
    return {
      worldLabel: "架空古代",
      powerSystemLabel: "军制与武道",
      powerLevelLabel: "军职层级",
      factionLabel: "门阀与边军",
      itemLabel: "军械文书",
    };
  }
  if (key === "urban") {
    return {
      worldLabel: "现代都市",
      powerSystemLabel: "能力与资源",
      powerLevelLabel: "资源等级",
      factionLabel: "公司与组织",
      itemLabel: "资源与人脉",
    };
  }
  return {
    worldLabel: "修真世界",
    powerSystemLabel: "修炼体系",
    powerLevelLabel: "境界",
    factionLabel: "宗门势力",
    itemLabel: "灵物功法",
  };
}

function normalizeGenerationGuidance(key: string, value: Record<string, unknown>) {
  if (
    Array.isArray(value.protagonistArchetypes) &&
    Array.isArray(value.conflictSeeds) &&
    Array.isArray(value.worldRuleSeeds) &&
    Array.isArray(value.forbiddenElements)
  ) {
    return value;
  }
  return key === "history"
    ? {
        protagonistArchetypes: ["寒门军校", "穿越边卒", "世家谋臣"],
        conflictSeeds: ["边军粮道被截", "门阀与皇权争军权"],
        worldRuleSeeds: ["粮草和道路决定行军速度", "没有修仙法术与宗门"],
        forbiddenElements: ["修仙境界", "境界", "法术", "宗门修炼", "宗门"],
      }
    : key === "urban"
      ? {
          protagonistArchetypes: ["被裁员的项目经理", "小城创业者", "调查记者"],
          conflictSeeds: ["融资对赌", "平台算法与劳动权益"],
          worldRuleSeeds: ["资本与人脉都有代价", "没有宗门与修仙境界"],
          forbiddenElements: ["修仙境界", "境界", "宗门修炼", "宗门", "法术飞升"],
        }
      : {
          protagonistArchetypes: ["被逐出宗门的杂役", "失去记忆的剑修"],
          conflictSeeds: ["宗门大比前的陷害", "秘境开启与旧案"],
          worldRuleSeeds: ["境界差距不能靠情绪抹平", "所有复活与延寿都有代价"],
          forbiddenElements: ["无代价飞升", "现代枪械体系"],
        };
}

function defaultGenreRules(key: string) {
  return key === "history"
    ? [
        {
          key: "no-cultivation",
          label: "不套用修仙境界",
          description: "历史题材不得出现修炼境界、法术和宗门体系。",
        },
      ]
    : key === "urban"
      ? [
          {
            key: "no-cultivation",
            label: "不套用修仙体系",
            description: "都市题材不得出现宗门修炼和境界突破。",
          },
        ]
      : [
          {
            key: "costly-power",
            label: "力量必有代价",
            description: "越阶与突破必须付出寿元、资源或关系代价。",
          },
        ];
}

function genrePackSettings(pack: GenrePackRecord) {
  return {
    key: pack.key,
    version: pack.version,
    fields: pack.fields,
    migrationReport: {
      fromVersion: null,
      toVersion: pack.version,
      missingFields: [],
      removedFields: [],
      conflicts: [],
    },
  };
}

function deriveFieldSchema(fields: Record<string, unknown>) {
  return Object.entries(fields).map(([key, value]) => ({
    key,
    label: fieldLabel(key),
    type: Array.isArray(value)
      ? ("list" as const)
      : typeof value === "number"
        ? ("number" as const)
        : typeof value === "boolean"
          ? ("boolean" as const)
          : ("text" as const),
    required: true,
    options: Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [],
  }));
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    genre: "题材",
    world: "世界",
    map: "地图",
    powerSystem: "力量体系",
    factions: "势力",
    specialElements: "题材要素",
    blessedLands: "洞天福地",
    militaryMerit: "军功簿",
    platformRules: "平台规则",
  };
  return labels[key] ?? key;
}

export interface ImportedSettingCandidate {
  id: string;
  type: ImportCandidateType;
  name: string;
  summary: string;
  sourceExcerpt: string;
}

function toInitialSettingEntity(candidate: ImportedSettingCandidate): InitialSettingEntity {
  const summary = candidate.summary.trim() || candidate.name;
  const attributes =
    candidate.type === "character"
      ? {
          bodyState: summary,
          knowledgeBoundary: "导入时未说明",
          relationshipSummary: "导入时未说明",
        }
      : candidate.type === "golden_finger"
        ? {
            rules: summary,
            cost: "导入时未说明",
            limits: "导入时未说明",
            growth: "导入时未说明",
          }
        : { details: summary };
  return {
    type: candidate.type,
    name: candidate.name,
    summary,
    description: candidate.sourceExcerpt,
    tags: ["导入"],
    attributes,
    importCandidateId: candidate.id,
  };
}
