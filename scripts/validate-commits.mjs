import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CONVENTIONAL_SUBJECT =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)]+\))?: (.+)$/;
const CHINESE_TEXT = /[\u3400-\u9fff]/;

export function validateCommitSubjects(subjects) {
  const errors = [];

  for (const subject of subjects) {
    const match = CONVENTIONAL_SUBJECT.exec(subject);
    if (!match) {
      errors.push(`Commit subject is not Conventional Commits: ${subject}`);
    }
    if (!CHINESE_TEXT.test(subject)) {
      errors.push(`Commit subject must include 简体中文: ${subject}`);
    }
  }

  return errors;
}

function main() {
  const { base, head } = parseArguments(process.argv.slice(2));
  const subjects = execFileSync("git", ["log", "--no-merges", "--format=%s", `${base}..${head}`], {
    encoding: "utf8",
  })
    .split("\n")
    .map((subject) => subject.trim())
    .filter(Boolean);
  const errors = validateCommitSubjects(subjects);

  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--base" && flag !== "--head") || !value) {
      throw new Error("Usage: validate-commits.mjs --base <ref> --head <ref>");
    }
    values.set(flag.slice(2), value);
  }
  const base = values.get("base");
  const head = values.get("head");
  if (!base || !head) {
    throw new Error("Usage: validate-commits.mjs --base <ref> --head <ref>");
  }
  return { base, head };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
