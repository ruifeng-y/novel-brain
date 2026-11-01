import { createDatabase } from './client';
import { systemJobs } from './schema';

const SEED_JOB_ID = '00000000-0000-4000-8000-000000000002';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed the database');
  }

  const { pool, db } = createDatabase(connectionString);
  const now = new Date();
  await db
    .insert(systemJobs)
    .values({
      id: SEED_JOB_ID,
      type: 'seed',
      status: 'completed',
      payload: { source: 'db:seed' },
      result: { seeded: true },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemJobs.id,
      set: {
        status: 'completed',
        result: { seeded: true },
        updatedAt: now,
      },
    });
  await pool.end();
  console.log('Seeded system_jobs');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
