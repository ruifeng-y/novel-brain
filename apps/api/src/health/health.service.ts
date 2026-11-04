import { Inject, Injectable } from "@nestjs/common";
import {
  type DependencyCheck,
  type LivenessData,
  type ReadinessData,
} from "@novel-brain/contracts";
import { elapsedMilliseconds } from "@novel-brain/core";

import { DATABASE_PROBE, QUEUE_PROBE, type DependencyProbe } from "./health.probes";

const PROBE_TIMEOUT_MS = 2_500;

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_PROBE) private readonly databaseProbe: DependencyProbe,
    @Inject(QUEUE_PROBE) private readonly queueProbe: DependencyProbe,
  ) {}

  getLiveness(): LivenessData {
    return {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessData> {
    const checks = await Promise.all([
      this.runProbe("database", this.databaseProbe),
      this.runProbe("queue", this.queueProbe),
    ]);
    const ready = checks.every((check) => check.status === "up");

    return {
      status: ready ? "ready" : "not_ready",
      service: "api",
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async runProbe(
    name: DependencyCheck["name"],
    probe: DependencyProbe,
  ): Promise<DependencyCheck> {
    const startedAt = process.hrtime.bigint();
    let timeout: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        probe.check(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("probe_timeout")), PROBE_TIMEOUT_MS);
        }),
      ]);

      return {
        name,
        status: "up",
        latencyMs: elapsedMilliseconds(startedAt),
      };
    } catch {
      return {
        name,
        status: "down",
        latencyMs: elapsedMilliseconds(startedAt),
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
