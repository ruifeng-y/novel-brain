import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { RetrievalController } from "./retrieval.controller";
import { RetrievalRepository } from "./retrieval.repository";
import { RetrievalService } from "./retrieval.service";

@Module({
  imports: [AuthModule],
  controllers: [RetrievalController],
  providers: [RetrievalRepository, RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
