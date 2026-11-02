import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createDatabase,
  createScopedDatabase,
  type Database,
  type DatabaseConnection,
} from '@novel/db';
import { sql } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

type WorkerTransactionContext = {
  client: PoolClient;
  db: Database;
  finished: boolean;
};

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly connection: DatabaseConnection;
  private readonly transactionContext = new AsyncLocalStorage<WorkerTransactionContext>();

  constructor(config: ConfigService) {
    this.connection = createDatabase(config.getOrThrow<string>('DATABASE_URL'));
  }

  get db() {
    return this.transactionContext.getStore()?.db ?? this.connection.db;
  }

  async withUserContext<T>(userId: string, callback: () => Promise<T>): Promise<T> {
    const client = await this.connection.pool.connect();
    const context: WorkerTransactionContext = {
      client,
      db: createScopedDatabase(client),
      finished: false,
    };
    let succeeded = false;
    try {
      await client.query('BEGIN');
      await context.db.execute(
        sql`select set_config('app.user_id', ${userId}, true),
                   set_config('app.auth', '', true)`,
      );
      const result = await this.transactionContext.run(context, callback);
      succeeded = true;
      return result;
    } finally {
      if (!context.finished) {
        context.finished = true;
        try {
          await client.query(succeeded ? 'COMMIT' : 'ROLLBACK');
        } catch {
          this.logger.error('Worker database transaction could not be finalized');
          await client.query('ROLLBACK').catch(() => undefined);
        } finally {
          client.release();
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.pool.end();
  }
}
