import { Injectable } from "@nestjs/common";
import type {
  ImportCandidateType,
  Work,
  WorkBranch,
  WorkCreateRequest,
  WorkListQuery,
  WorkOverview,
  SettingsImportConfirmRequest,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
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

    const templatePack =
      input.mode === "template"
        ? await this.repository.findGenrePackByKey(input.templateKey)
        : undefined;
    if (input.mode === "template" && !templatePack) {
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
      templatePackId: templatePack?.id ?? null,
      settings: {},
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
      templatePackId: null,
      settings: {
        importId,
        materializedSettingCount: initialSettingEntities.length,
      },
      initialSettingEntities,
      idempotencyKey,
      audit,
    });
    return this.toOverview(userId, created.work, created.branch);
  }

  async get(userId: string, workId: string): Promise<WorkOverview> {
    const work = await this.repository.find(userId, workId);
    if (!work) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    return this.toOverview(userId, work);
  }

  async branches(userId: string, workId: string): Promise<WorkBranch[]> {
    const work = await this.repository.find(userId, workId);
    if (!work) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品不存在或无权访问");
    }
    const branches = await this.repository.findBranches(userId, workId);
    return branches.map((branch) => this.toBranchContract(branch));
  }

  private async toOverview(
    userId: string,
    work: WorkRecord,
    suppliedBranch?: WorkBranchRecord,
    suppliedTemplatePack?: GenrePackRecord,
  ): Promise<WorkOverview> {
    const branches = suppliedBranch
      ? [suppliedBranch]
      : await this.repository.findBranches(userId, work.id);
    const mainBranch = branches.find((branch) => branch.name === "main");
    if (!mainBranch?.headNodeId) {
      throw new Error("Work is missing its main branch head");
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
      templatePack: templatePack
        ? {
            id: templatePack.id,
            key: templatePack.key as Work["genre"],
            version: templatePack.version,
            label: templatePack.label,
            fields: templatePack.fields,
          }
        : null,
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
