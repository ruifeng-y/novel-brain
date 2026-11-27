import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BlueprintController } from "./blueprint.controller";
import { BlueprintJobQueue } from "./blueprint.queue";
import { BlueprintRepository } from "./blueprint.repository";
import { BlueprintService } from "./blueprint.service";

@Module({
  imports: [AuthModule],
  controllers: [BlueprintController],
  providers: [BlueprintRepository, BlueprintJobQueue, BlueprintService],
  exports: [BlueprintService],
})
export class BlueprintModule {}
