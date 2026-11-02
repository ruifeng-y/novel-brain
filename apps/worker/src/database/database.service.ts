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
    this.connection = createDatabase(
      withApplicationName(config.getOrThrow<string>('DATABASE_URL'), 'novel-worker'),
    );
  }

  get db() {
    return this.transactionContext.getStore()?.db ?? this.connection.db;
  }

  async withUserContext<T>(userId: string, callback: () => Promise<T>): Promise<T> {
    const client = await this.connection.pool.connect();
    const context: WorkerTransactionContext = {
      client,
      db: createScopedDatabase(client, 'session'),
      finished: false,
    };
    try {
      await context.db.execute(
        sql`select set_config('app.user_id', ${userId}, false),
                   set_config('app.auth', '', false)`,
      );
      return await this.transactionContext.run(context, callback);
    } finally {
      if (!context.finished) {
        context.finished = true;
        try {
          await context.db.execute(
            sql`select set_config('app.user_id', '', false),
                       set_config('app.auth', '', false)`,
          );
        } catch {
          this.logger.error('Worker database tenant context could not be cleared');
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

function withApplicationName(connectionString: string, applicationName: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('application_name', applicationName);
  return url.toString();
}
