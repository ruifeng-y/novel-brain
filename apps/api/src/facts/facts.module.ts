import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { FactsController } from "./facts.controller";
import { FactsRepository } from "./facts.repository";
import { FactsService } from "./facts.service";

@Module({
  imports: [AuthModule],
  controllers: [FactsController],
  providers: [FactsRepository, FactsService],
})
export class FactsModule {}
