import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorksController } from "./works.controller";
import { WorksRepository } from "./works.repository";
import { WorksService } from "./works.service";

@Module({
  imports: [AuthModule],
  controllers: [WorksController],
  providers: [WorksRepository, WorksService],
})
export class WorksModule {}
