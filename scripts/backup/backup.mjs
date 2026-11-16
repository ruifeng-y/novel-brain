import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createBackup,
  loadBackup,
  pruneBackups,
  readBackupKey,
  restoreBackup,
  runBackupDrill,
  runOrphanAudit,
  verifyBackupArtefacts,
} from "./backup-runtime.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const booleanOptions = new Set(["apply"]);
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}.`);
    }
    const name = argument.slice(2);
    if (booleanOptions.has(name)) {
      options[name] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}.`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, name) {
  if (!options[name]) {
    throw new Error(`Missing required --${name}.`);
  }
  return options[name];
}

function resolved(value) {
  return path.resolve(repositoryRoot, value);
}

function writeOutput(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  switch (command) {
    case "create": {
      const key = await readBackupKey({ keyFile: options["key-file"] });
      const result = await createBackup({
        project: required(options, "project"),
        outputDirectory: resolved(options.output ?? "artifacts/backups"),
        bucket: options.bucket ?? "novelbrain",
        key,
      });
      writeOutput({
        directory: path.relative(repositoryRoot, result.directory).replaceAll("\\", "/"),
        backupId: result.manifest.backupId,
        manifestSha256: result.manifestSha256,
        dataset: result.dataset,
      });
      return;
    }
    case "verify": {
      const key = await readBackupKey({ keyFile: options["key-file"] });
      const backupDirectory = resolved(required(options, "backup"));
      const backup = await loadBackup(backupDirectory);
      const verification = await verifyBackupArtefacts({ directory: backupDirectory, key });
      writeOutput({ backupId: backup.manifest.backupId, ...verification });
      return;
    }
    case "restore": {
      const key = await readBackupKey({ keyFile: options["key-file"] });
      const result = await restoreBackup({
        backupDirectory: resolved(required(options, "backup")),
        key,
        project: options.project,
      });
      writeOutput(result);
      return;
    }
    case "drill": {
      const key = await readBackupKey({ keyFile: options["key-file"] });
      const evidence = await runBackupDrill({
        outputDirectory: resolved(options.output ?? "artifacts/backups/drill"),
        bucket: options.bucket ?? "novelbrain",
        key,
      });
      if (options.evidence) {
        const evidencePath = resolved(options.evidence);
        await mkdir(path.dirname(evidencePath), { recursive: true });
        await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
      }
      writeOutput(evidence);
      return;
    }
    case "orphans": {
      const result = await runOrphanAudit({
        backupDirectory: resolved(required(options, "backup")),
        project: required(options, "project"),
        minimumAgeDays: Number(options["minimum-age-days"] ?? 30),
        apply: Boolean(options.apply),
        confirmBucket: options["confirm-bucket"],
      });
      writeOutput(result);
      return;
    }
    case "prune": {
      const result = await pruneBackups({
        directory: resolved(options.directory ?? "artifacts/backups"),
        apply: Boolean(options.apply),
      });
      writeOutput(result);
      return;
    }
    case "show": {
      const backup = await loadBackup(resolved(required(options, "backup")));
      writeOutput({
        backupId: backup.manifest.backupId,
        manifestSha256: backup.manifestSha256,
        manifest: backup.manifest,
      });
      return;
    }
    default:
      throw new Error(
        "Usage: backup.mjs <create|verify|restore|drill|orphans|prune|show> [options]",
      );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
