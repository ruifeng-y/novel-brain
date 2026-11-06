import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { AgentGrantStore } from "@novel-brain/db";

@Injectable()
export class AgentRuntimeRepository extends AgentGrantStore implements OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
