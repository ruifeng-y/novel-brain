import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase, type DatabaseConnection } from '@novel/db';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly connection: DatabaseConnection;

  constructor(config: ConfigService) {
    this.connection = createDatabase(config.getOrThrow<string>('DATABASE_URL'));
  }

  get pool() {
    return this.connection.pool;
  }

  get db() {
    return this.connection.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
