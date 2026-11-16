import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { buildWorkExportArtifact } from "@novel-brain/core";
import type { ExportWorkJob } from "@novel-brain/contracts";
import { OBJECT_STORAGE, type ObjectStorage } from "@novel-brain/storage";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  WorkerWorkExportRepository,
  WorkExportSourceChangedError,
  type RenderedWorkExport,
} from "./work-export.repository";

@Injectable()
export class WorkExportProcessor {
  constructor(
    private readonly repository: WorkerWorkExportRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async process(
    payload: ExportWorkJob,
    attempt: { number: number; maxAttempts: number } = { number: 1, maxAttempts: 1 },
  ): Promise<"succeeded" | "failed"> {
    const identity = {
      jobId: payload.jobId,
      exportId: payload.exportId,
      userId: payload.actorId,
      workId: payload.workId,
      branchId: payload.branchId,
    };
    try {
      const loaded = await this.repository.loadAndBegin(payload);
      if (!loaded) {
        return "succeeded";
      }
      let rendered =
        loaded.checkpoint.step === "render" || loaded.checkpoint.step === "complete"
          ? await this.repository.loadRendered(loaded)
          : null;
      if (rendered && !(await this.objectMatches(rendered))) {
        rendered = null;
      }
      if (!rendered) {
        const artifact = buildWorkExportArtifact({
          work: loaded.work,
          branch: loaded.branch,
          resolvedVersionNodeId: loaded.source.resolvedVersionNodeId,
          request: loaded.request,
          chapters: loaded.chapters,
          supplements: loaded.supplements,
        });
        const objectKey = `work-exports/${loaded.userId}/${loaded.workId}/${loaded.branchId}/${loaded.exportId}.${extensionOf(artifact.fileName)}`;
        await this.storage.putObject({
          key: objectKey,
          bytes: artifact.bytes,
          contentType: artifact.contentType,
        });
        rendered = await this.repository.checkpointRendered({
          loaded,
          manifest: artifact.manifest,
          objectKey,
          checksum: artifact.checksum,
          contentType: artifact.contentType,
          fileName: artifact.fileName,
          byteSize: artifact.bytes.byteLength,
        });
      }
      await this.repository.complete(rendered);
      return "succeeded";
    } catch (error) {
      if (error instanceof WorkExportSourceChangedError) {
        await this.repository.fail(identity, {
          code: "WORK_EXPORT_SOURCE_CHANGED",
          message: "导出源版本已变化，原稿和版本记录未被修改",
        });
        return "failed";
      }
      if (attempt.number >= attempt.maxAttempts) {
        await this.repository.fail(identity, {
          code: "WORK_EXPORT_RENDER_FAILED",
          message: "导出渲染失败，请重试",
        });
        return "failed";
      }
      throw error;
    }
  }

  async cleanupExpiredReceipts(now = new Date()): Promise<number> {
    const keys = await this.repository.listExpiredObjectKeys(now);
    await this.storage.deleteObjects(keys);
    return this.repository.markExpiredReceipts(now);
  }

  listPendingJobs(): Promise<ExportWorkJob[]> {
    return this.repository.listPendingJobs();
  }

  onModuleDestroy(): Promise<void> {
    return this.repository.onModuleDestroy();
  }

  private async objectMatches(rendered: RenderedWorkExport): Promise<boolean> {
    try {
      const stored = await this.storage.getObject(rendered.objectKey);
      return sha256(stored) === rendered.checksum && stored.byteLength === rendered.byteSize;
    } catch {
      return false;
    }
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function extensionOf(fileName: string): string {
  const extension = fileName.split(".").at(-1);
  if (!extension || !/^[a-z0-9]{2,5}$/u.test(extension)) {
    throw new Error("Export artifact file extension is invalid");
  }
  return extension;
}
