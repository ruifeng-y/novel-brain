import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PowerItemsController } from "./power-items.controller";
import { PowerItemsRepository } from "./power-items.repository";
import { PowerItemsService } from "./power-items.service";
import { WorldController } from "./world.controller";
import { WorldRepository } from "./world.repository";
import { WorldService } from "./world.service";

@Module({
  imports: [AuthModule],
  controllers: [WorldController, PowerItemsController],
  providers: [WorldRepository, WorldService, PowerItemsRepository, PowerItemsService],
  exports: [WorldService, PowerItemsService],
})
export class WorldModule {}
