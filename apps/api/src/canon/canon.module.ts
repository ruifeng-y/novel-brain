import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CanonController } from "./canon.controller";
import { CanonRepository } from "./canon.repository";
import { CanonService } from "./canon.service";

@Module({
  imports: [AuthModule],
  controllers: [CanonController],
  providers: [CanonRepository, CanonService],
})
export class CanonModule {}
