import { Injectable } from "@nestjs/common";
import { checkStorageHealth } from "@novel-brain/core";

import type { DependencyProbe } from "./health.probes";

@Injectable()
export class StorageProbeService implements DependencyProbe {
  isConfigured(): boolean {
    return Boolean(process.env.STORAGE_HEALTH_URL);
  }

  async check(): Promise<void> {
    const healthUrl = process.env.STORAGE_HEALTH_URL;
    if (!healthUrl) {
      throw new Error("STORAGE_HEALTH_URL is required");
    }
    await checkStorageHealth(healthUrl);
  }
}
