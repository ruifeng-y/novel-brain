import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AgentGrantController } from "./agent-grant.controller";
import { AgentGrantService } from "./agent-grant.service";
import { AgentRuntimeRepository } from "./agent-runtime.repository";

@Module({
  imports: [AuthModule],
  controllers: [AgentGrantController],
  providers: [AgentRuntimeRepository, AgentGrantService],
  exports: [AgentGrantService],
})
export class AgentRuntimeModule {}
