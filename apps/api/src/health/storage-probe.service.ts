import { Injectable } from "@nestjs/common";

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
    const response = await fetch(healthUrl, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      throw new Error(`Object storage health check failed with HTTP ${response.status}`);
    }
  }
}
