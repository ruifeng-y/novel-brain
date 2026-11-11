import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AgentGrantController } from "./agent-grant.controller";
import { AgentGrantService } from "./agent-grant.service";
import { AgentRuntimeRepository } from "./agent-runtime.repository";
import { AgentTraceController } from "./agent-trace.controller";
import { AgentTraceRepository } from "./agent-trace.repository";
import { AgentTraceService } from "./agent-trace.service";

@Module({
  imports: [AuthModule],
  controllers: [AgentGrantController, AgentTraceController],
  providers: [AgentRuntimeRepository, AgentGrantService, AgentTraceRepository, AgentTraceService],
  exports: [AgentGrantService],
})
export class AgentRuntimeModule {}
