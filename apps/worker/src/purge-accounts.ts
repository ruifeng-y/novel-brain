import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { AccountPurgeRunner } from './accounts/account-purge.runner';
import { ObjectStorageService } from './storage/object-storage.service';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((value) => value.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined;
  const config = new ConfigService(process.env);
  const storage = new ObjectStorageService(config);
  const runner = new AccountPurgeRunner(config, storage);
  try {
    const result = await runner.run({ dryRun, limit });
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
