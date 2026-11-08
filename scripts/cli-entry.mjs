import { pathToFileURL } from "node:url";

export function runCli(moduleUrl, scriptPath, main, exitCode = 1) {
  if (!scriptPath || moduleUrl !== pathToFileURL(scriptPath).href) {
    return;
  }

  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = exitCode;
  }
}
