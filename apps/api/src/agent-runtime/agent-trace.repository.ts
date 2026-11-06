import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { AgentTraceStore } from "@novel-brain/db";

@Injectable()
export class AgentTraceRepository extends AgentTraceStore implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
