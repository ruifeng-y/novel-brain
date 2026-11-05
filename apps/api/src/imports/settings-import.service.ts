import { Injectable } from "@nestjs/common";
import type {
  ImportCandidate,
  ImportConflict,
  SettingsImport,
  SettingsImportConfirmRequest,
  SettingsImportConflictDecisionRequest,
  SettingsImportCreateRequest,
  WorkOverview,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsImportRepository } from "./settings-import.repository";
import type { ImportCandidateRecord, SettingsImportRecord } from "./settings-import.repository";
import { parseSettingsText } from "./settings-import.parser";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksService } from "../works/works.service";
import type { WorksAuditContext } from "../works/works.repository";

@Injectable()
export class SettingsImportService {
  constructor(
    private readonly repository: SettingsImportRepository,
    private readonly worksService: WorksService,
  ) {}

  async create(
    userId: string,
    input: SettingsImportCreateRequest,
    source: { kind: "paste" | "file"; name: string | null } = { kind: "paste", name: null },
  ): Promise<SettingsImport> {
    const parsed = parseSettingsText(input.text);
    const candidates = parsed.candidates.map((candidate) => ({
      ...candidate,
      id: uuidv7(),
    }));
    const conflicts = parsed.conflicts.map((conflict) => {
      const primary = candidates[conflict.primaryCandidateIndex];
      const secondary = candidates[conflict.secondaryCandidateIndex];
      if (!primary || !secondary) {
        throw new Error("Parsed settings conflict references a missing candidate");
      }
      return {
        id: uuidv7(),
        type: conflict.type,
        summary: conflict.summary,
        primaryCandidateId: primary.id,
        secondaryCandidateId: secondary.id,
      };
    });
    const record = await this.repository.create({
      id: uuidv7(),
      reportId: uuidv7(),
      userId,
      sourceKind: source.kind,
      sourceName: input.sourceName ?? source.name,
      sourceText: input.text,
      candidates,
      conflicts,
      unparsed: parsed.unparsed,
    });
    return this.toContract(record);
  }

  async get(userId: string, importId: string): Promise<SettingsImport> {
    const record = await this.repository.find(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return this.toContract(record);
  }

  async decideConflict(
    userId: string,
    importId: string,
    conflictId: string,
    input: SettingsImportConflictDecisionRequest,
  ): Promise<SettingsImport> {
    const record = await this.repository.decideConflict({
      userId,
      importId,
      conflictId,
      decision: input.decision,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "冲突记录不存在或无权访问");
    }
    return this.toContract(record);
  }

  async confirm(
    userId: string,
    displayName: string,
    importId: string,
    input: SettingsImportConfirmRequest,
    audit: WorksAuditContext,
    idempotencyKey: string,
  ): Promise<WorkOverview> {
    const record = await this.repository.find(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    if (record.job.status === "completed" && record.job.workId) {
      return this.worksService.get(userId, record.job.workId);
    }
    if (record.conflicts.some((conflict) => conflict.decision === "pending")) {
      throw new ApiError(409, "IMPORT_CONFLICT_UNRESOLVED", "请先裁决识别结果中的冲突");
    }
    const acceptedCandidates = record.candidates
      .filter((candidate) => candidate.status === "accepted")
      .map((candidate) => ({
        id: candidate.id,
        type: candidate.candidateType as ImportCandidate["type"],
        name: candidate.name,
        summary: candidate.summary,
        sourceExcerpt: candidate.sourceExcerpt,
      }));

    const work = await this.worksService.createFromSettingsImport(
      userId,
      displayName,
      importId,
      input,
      audit,
      idempotencyKey,
      acceptedCandidates,
    );
    await this.repository.markCompleted({
      userId,
      importId,
      workId: work.id,
      branchId: work.mainBranch.id,
    });
    return work;
  }

  private toContract(record: SettingsImportRecord): SettingsImport {
    const acceptedIds = new Set(record.report.acceptedCandidateIds);
    const pendingIds = new Set(record.report.pendingCandidateIds);
    const candidateById = new Map(
      record.candidates.map((candidate) => [candidate.id, toCandidateContract(candidate)]),
    );
    const conflicts = record.conflicts.map((conflict) => {
      const primary = candidateById.get(conflict.primaryCandidateId);
      const secondary = candidateById.get(conflict.secondaryCandidateId);
      if (!primary || !secondary) {
        throw new Error("Settings import conflict references a missing candidate");
      }
      return {
        id: conflict.id,
        type: conflict.conflictType as ImportConflict["type"],
        summary: conflict.summary,
        candidates: [primary, secondary] as ImportConflict["candidates"],
        decision: conflict.decision as ImportConflict["decision"],
        decidedAt: conflict.decidedAt?.toISOString() ?? null,
      };
    });
    return {
      id: record.job.id,
      status: record.job.status as SettingsImport["status"],
      sourceKind: record.job.sourceKind as SettingsImport["sourceKind"],
      sourceName: record.job.sourceName,
      report: {
        accepted: record.candidates
          .filter((candidate) => acceptedIds.has(candidate.id))
          .map(toCandidateContract),
        pending: record.candidates
          .filter((candidate) => pendingIds.has(candidate.id))
          .map(toCandidateContract),
        conflicts,
        unparsed: record.report.unparsed,
      },
      canConfirm: conflicts.every((conflict) => conflict.decision !== "pending"),
      confirmedWorkId: record.job.workId,
      createdAt: record.job.createdAt.toISOString(),
    };
  }
}

function toCandidateContract(candidate: ImportCandidateRecord): ImportCandidate {
  return {
    id: candidate.id,
    type: candidate.candidateType as ImportCandidate["type"],
    name: candidate.name,
    summary: candidate.summary,
    sourceExcerpt: candidate.sourceExcerpt,
    confidence: candidate.confidence,
    status: candidate.status as ImportCandidate["status"],
  };
}
