import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { NotificationController } from "./notification.controller";
import { NotificationRepository } from "./notification.repository";
import { NotificationService } from "./notification.service";

@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [NotificationRepository, NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
