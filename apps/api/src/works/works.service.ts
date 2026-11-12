import { Injectable } from "@nestjs/common";
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
  type WorkListQuery,
  type WorkOverview,
  type SettingsImportConfirmRequest,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
import { invalidCursorError, type CursorPageResult } from "../common/cursor-page";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReadinessService } from "../readiness/readiness.service";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksRepository } from "./works.repository";
import type { WorkBranchRecord, WorkRecord, WorksAuditContext } from "./works.repository";
import type { InitialSettingEntity } from "./works.repository";
import type { GenrePackRecord } from "./works.repository";

@Injectable()
export class WorksService {
  constructor(
    private readonly repository: WorksRepository,
    private readonly readiness: ReadinessService,
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
      sourceMode: input.mode,
      idea: input.mode === "idea" ? input.idea : null,
      templatePackId: templatePack.id,
      settings: { genrePack: genrePackSettings(templatePack) },
      idempotencyKey: idempotencyKey ?? null,
      audit,
    });
    return this.toOverview(userId, created.work, created.branch, templatePack);
  }

  async list(
    userId: string,
    query: WorkListQuery,
  ): Promise<{ works: Work[]; nextCursor: string | null }> {
    const result = await this.repository.list(userId, query);
    if (result === "invalid_cursor") {
      throw invalidCursorError();
    }
    const packs = await this.repository.findGenrePacksByIds(
      result.works.flatMap((work) => (work.templatePackId ? [work.templatePackId] : [])),
    );
    const packById = new Map(packs.map((pack) => [pack.id, pack]));
    return {
      works: result.works.map((work) =>
        this.toContract(work, work.templatePackId ? packById.get(work.templatePackId) : undefined),
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

  private toContract(work: WorkRecord, templatePack?: GenrePackRecord): Work {
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
      createdAt: work.createdAt.toISOString(),
      updatedAt: work.updatedAt.toISOString(),
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
