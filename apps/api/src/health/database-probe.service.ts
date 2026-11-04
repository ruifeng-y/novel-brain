import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool } from "pg";

import type { DependencyProbe } from "./health.probes";

@Injectable()
export class DatabaseProbeService implements DependencyProbe, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }

    this.pool = createDatabasePool(databaseUrl);
  }

  async check(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
