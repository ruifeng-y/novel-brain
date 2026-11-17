import { Injectable } from "@nestjs/common";
import type { PublishCheckRequest } from "@novel-brain/contracts";
import { buildPublishPreview, type PublishMetadataInput } from "@novel-brain/core";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PublishPreviewRepository, type PublishContext } from "./publish-preview.repository";

@Injectable()
export class PublishPreviewService {
  constructor(private readonly repository: PublishPreviewRepository) {}

  async create(userId: string, context: PublishContext, request: PublishCheckRequest) {
    const source = await this.repository.loadSource(userId, context, request.exportId);
    if (source === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导出记录不存在或无权访问");
    }
    if (source === "not_ready") {
      throw new ApiError(409, "PUBLISH_EXPORT_NOT_READY", "导出文件尚未生成完成");
    }
    if (source === "expired") {
      throw new ApiError(410, "PUBLISH_EXPORT_EXPIRED", "导出文件已过期，请重新导出");
    }
    if (source === "source_changed") {
      throw new ApiError(409, "WORK_EXPORT_SOURCE_CHANGED", "导出源版本已变化，请重新导出");
    }
    const preview = buildPublishPreview({
      platformPreset: request.platformPreset,
      metadata: definedMetadata(request.metadata),
      work: source.work,
      export: source.export,
      chapters: source.chapters,
      goldenThree: source.goldenThree,
    });
    return this.repository.save(userId, context, request, {
      exportId: source.exportId,
      workId: source.work.id,
      branchId: source.branch.id,
      platformPreset: request.platformPreset,
      status: preview.status,
      publishReady: preview.publishReady,
      sourceVersionNodeId: source.export.sourceVersionNodeId,
      requestedVersionNodeId: source.export.requestedVersionNodeId,
      manifestHash: source.export.manifestHash,
      platform: preview.platform,
      metadata: preview.metadata,
      checks: preview.checks,
      catalog: preview.catalog,
      readerPreview: preview.readerPreview,
      publishCopy: preview.publishCopy,
    });
  }

  async get(userId: string, context: PublishContext, previewId: string) {
    const preview = await this.repository.get(userId, context, previewId);
    if (!preview) {
      throw new ApiError(404, "PUBLISH_PREVIEW_NOT_FOUND", "发布预览不存在");
    }
    return preview;
  }

  list(userId: string, context: PublishContext) {
    return this.repository.list(userId, context);
  }
}

function definedMetadata(metadata: PublishCheckRequest["metadata"]): PublishMetadataInput {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  ) as PublishMetadataInput;
}
