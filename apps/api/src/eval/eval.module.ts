import { Module } from "@nestjs/common";

import { EvalRepository } from "./eval.repository";
import { EvalService } from "./eval.service";

@Module({
  providers: [EvalRepository, EvalService],
  exports: [EvalService],
})
export class EvalModule {}
