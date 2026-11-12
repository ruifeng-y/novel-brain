import { Injectable } from "@nestjs/common";
import type { NotificationListQuery } from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NotificationRepository, type NotificationPage } from "./notification.repository";

@Injectable()
export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  async list(userId: string, query: NotificationListQuery): Promise<NotificationPage> {
    try {
      return await this.repository.list(userId, query);
    } catch (error) {
      if (error instanceof Error && error.message === "NOTIFICATION_CURSOR_INVALID") {
        throw new ApiError(400, "VALIDATION_INVALID", "通知游标无效");
      }
      throw error;
    }
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.repository.markRead(userId, notificationId);
    if (!notification) {
      throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "通知不存在或无权访问");
    }
    return notification;
  }

  async markAllRead(userId: string): Promise<number> {
    return this.repository.markAllRead(userId);
  }
}
