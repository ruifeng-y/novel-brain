import { Module } from "@nestjs/common";
import { createObjectStorageFromEnvironment, OBJECT_STORAGE } from "@novel-brain/storage";

import { AuthModule } from "../auth/auth.module";
import { BlueprintModule } from "../blueprints/blueprint.module";
import { ReadinessModule } from "../readiness/readiness.module";
import { GenrePackController } from "./genre-pack.controller";
import { WorksController } from "./works.controller";
import { WorksRepository } from "./works.repository";
import { WorksService } from "./works.service";

@Module({
  imports: [AuthModule, BlueprintModule, ReadinessModule],
  controllers: [WorksController, GenrePackController],
  providers: [
    WorksRepository,
    WorksService,
    {
      provide: OBJECT_STORAGE,
      useFactory: () => createObjectStorageFromEnvironment(),
    },
  ],
  exports: [WorksService],
})
export class WorksModule {}
