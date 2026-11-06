import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { GoldenThreeController } from "./golden-three.controller";
import { GoldenThreeRepository } from "./golden-three.repository";
import { GoldenThreeService } from "./golden-three.service";

@Module({
  imports: [AuthModule],
  controllers: [GoldenThreeController],
  providers: [GoldenThreeRepository, GoldenThreeService],
  exports: [GoldenThreeService],
})
export class GoldenThreeModule {}
