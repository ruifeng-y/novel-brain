import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_ADMIN_URL ??
      process.env.DATABASE_URL ??
      'postgres://novel:novel@localhost:5432/novel',
  },
});
