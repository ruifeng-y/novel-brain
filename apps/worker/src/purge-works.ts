import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageService } from './storage/object-storage.service';
import { WorkPurgeRunner } from './works/work-purge.runner';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((value) => value.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined;
  const nowArg = process.argv.find((value) => value.startsWith('--now='));
  const now = nowArg ? new Date(nowArg.slice('--now='.length)) : undefined;
  if (now && Number.isNaN(now.getTime())) {
    throw new Error('--now must be an ISO timestamp');
  }

  const config = new ConfigService(process.env);
  const storage = new ObjectStorageService(config);
  const runner = new WorkPurgeRunner(config, storage);
  try {
    const result = await runner.run({ dryRun, limit, ...(now ? { now } : {}) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await runner.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
