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

export type DatabaseTransactionContext = {
  client: PoolClient;
  db: Database;
  finished: boolean;
};

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly connection: DatabaseConnection;
  private readonly transactionContext = new AsyncLocalStorage<DatabaseTransactionContext>();

  constructor(config: ConfigService) {
    this.connection = createDatabase(config.getOrThrow<string>('DATABASE_URL'));
  }

  get pool() {
    return this.connection.pool;
  }

  get db() {
    return this.transactionContext.getStore()?.db ?? this.connection.db;
  }

  async beginTransaction(): Promise<DatabaseTransactionContext> {
    const client = await this.connection.pool.connect();
    try {
      await client.query('BEGIN');
      return {
        client,
        db: createScopedDatabase(client),
        finished: false,
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  runInContext<T>(context: DatabaseTransactionContext, callback: () => T): T {
    return this.transactionContext.run(context, callback);
  }

  async activateTenant(userId: string): Promise<void> {
    const context = this.transactionContext.getStore();
    if (!context) {
      throw new Error('Tenant database context is not active');
    }
    await context.db.execute(
      sql`select set_config('app.user_id', ${userId}, true),
                 set_config('app.auth', '', true)`,
    );
  }

  async withUserContext<T>(userId: string, callback: () => Promise<T>): Promise<T> {
    return this.withTransaction({ userId, auth: false }, callback);
  }

  async withAuthContext<T>(callback: () => Promise<T>): Promise<T> {
    return this.withTransaction({ userId: null, auth: true, commitOnError: true }, callback);
  }

  async finishTransaction(context: DatabaseTransactionContext, commit: boolean): Promise<void> {
    if (context.finished) {
      return;
    }
    context.finished = true;

    try {
      await context.client.query(commit ? 'COMMIT' : 'ROLLBACK');
    } catch (error) {
      try {
        await context.client.query('ROLLBACK');
      } catch {
        this.logger.error('Database transaction rollback failed');
      }
      throw error;
    } finally {
      context.client.release();
    }
  }

  private async withTransaction<T>(
    setup: { userId: string | null; auth: boolean; commitOnError?: boolean },
    callback: () => Promise<T>,
  ): Promise<T> {
    const active = this.transactionContext.getStore();
    if (active) {
      return active.db.transaction(async (tx) => {
        const nested: DatabaseTransactionContext = { ...active, db: tx };
        await this.applyContext(tx, setup);
        try {
          return await this.transactionContext.run(nested, callback);
        } finally {
          if (setup.auth) {
            await tx.execute(sql`select set_config('app.auth', '', true)`);
          }
        }
      });
    }

    const context = await this.beginTransaction();
    let succeeded = false;
    try {
      const result = await this.transactionContext.run(context, async () => {
        await this.applyContext(context.db, setup);
        return callback();
      });
      succeeded = true;
      return result;
    } catch (error) {
      succeeded = setup.commitOnError === true;
      throw error;
    } finally {
      await this.finishTransaction(context, succeeded);
    }
  }

  private async applyContext(
    db: Database,
    setup: { userId: string | null; auth: boolean; commitOnError?: boolean },
  ): Promise<void> {
    if (setup.userId) {
      await db.execute(
        sql`select set_config('app.user_id', ${setup.userId}, true),
                   set_config('app.auth', ${setup.auth ? 'on' : ''}, true)`,
      );
      return;
    }
    await db.execute(
      sql`select set_config('app.user_id', '', true),
                 set_config('app.auth', ${setup.auth ? 'on' : ''}, true)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
