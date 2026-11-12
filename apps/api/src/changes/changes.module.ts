import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BranchController, ChangesController } from "./changes.controller";
import { ChangesRepository } from "./changes.repository";
import { ChangesService } from "./changes.service";

@Module({
  imports: [AuthModule],
  controllers: [ChangesController, BranchController],
  providers: [ChangesRepository, ChangesService],
  exports: [ChangesService],
})
export class ChangesModule {}
