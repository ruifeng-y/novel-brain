import { Injectable } from "@nestjs/common";
import { buildWorkExportArtifact } from "@novel-brain/core";
import type { ExportWorkJob } from "@novel-brain/contracts";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerWorkExportRepository, WorkExportSourceChangedError } from "./work-export.repository";

@Injectable()
export class WorkExportProcessor {
  constructor(private readonly repository: WorkerWorkExportRepository) {}

  async process(payload: ExportWorkJob): Promise<"succeeded" | "failed"> {
    const loaded = await this.repository.loadAndBegin(payload);
    if (!loaded) {
      return "succeeded";
    }
    try {
      const artifact = buildWorkExportArtifact({
        work: loaded.work,
        branch: loaded.branch,
        resolvedVersionNodeId: loaded.source.resolvedVersionNodeId,
        request: loaded.request,
        chapters: loaded.chapters,
        supplements: loaded.supplements,
      });
      await this.repository.complete({
        loaded,
        manifest: artifact.manifest,
        checksum: artifact.checksum,
        contentType: artifact.contentType,
        fileName: artifact.fileName,
        bytes: artifact.bytes,
      });
      return "succeeded";
    } catch (error) {
      const failure =
        error instanceof WorkExportSourceChangedError
          ? {
              code: "WORK_EXPORT_SOURCE_CHANGED",
              message: "导出源版本已变化，原稿和版本记录未被修改",
            }
          : {
              code: "WORK_EXPORT_RENDER_FAILED",
              message: "导出渲染失败，请重试",
            };
      await this.repository.fail(loaded, failure);
      return "failed";
    }
  }

  cleanupExpiredReceipts(now = new Date()): Promise<number> {
    return this.repository.cleanupExpiredReceipts(now);
  }

  onModuleDestroy(): Promise<void> {
    return this.repository.onModuleDestroy();
  }
}
