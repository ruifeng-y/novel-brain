import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorldController } from "./world.controller";
import { WorldRepository } from "./world.repository";
import { WorldService } from "./world.service";

@Module({
  imports: [AuthModule],
  controllers: [WorldController],
  providers: [WorldRepository, WorldService],
  exports: [WorldService],
})
export class WorldModule {}
