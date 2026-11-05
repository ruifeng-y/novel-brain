import { Injectable } from "@nestjs/common";
import type {
  Work,
  WorkBranch,
  WorkCreateRequest,
  WorkListQuery,
  WorkOverview,
  WorkReadiness,
  SettingsImportConfirmRequest,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksRepository } from "./works.repository";
import type { WorkBranchRecord, WorkRecord, WorksAuditContext } from "./works.repository";
import type { GenrePackRecord } from "./works.repository";

@Injectable()
export class WorksService {
  constructor(private readonly repository: WorksRepository) {}

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
  ): Promise<WorkOverview> {
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
      settings: { importId },
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
    const modelConfigReady = await this.repository.hasModelConfig(userId);
    const templatePack =
      suppliedTemplatePack ??
      (work.templatePackId
        ? (await this.repository.findGenrePacksByIds([work.templatePackId]))[0]
        : undefined);
    return {
      ...this.toContract(work, templatePack),
      mainBranch: this.toBranchContract(mainBranch),
      branches: branches.map((branch) => this.toBranchContract(branch)),
      readiness: readiness(modelConfigReady),
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

function readiness(modelConfigReady: boolean): WorkReadiness {
  const items: WorkReadiness["items"] = [
    { key: "main_branch", label: "主创作线", ready: true },
    { key: "model_config", label: "模型配置", ready: modelConfigReady },
    { key: "story_bible", label: "故事圣经", ready: false },
    { key: "outline", label: "大纲", ready: false },
  ];
  const completed = items.filter((item) => item.ready).length;
  return {
    status: completed === items.length ? "ready" : completed === 0 ? "not_ready" : "partial",
    completed,
    total: items.length,
    items,
  };
}
