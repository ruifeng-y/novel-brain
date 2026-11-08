import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { parseReviewRangeArguments } from "./review-range-arguments.mjs";

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
    if (!CHINESE_TEXT.test(match?.[1] ?? "")) {
      errors.push(`Commit subject must include 简体中文: ${subject}`);
    }
  }

  return errors;
}

export function validateCommitMessages(messages) {
  const errors = [];

  for (const message of messages) {
    const [subject, ...bodyLines] = message.split(/\r?\n/);
    const body = bodyLines.join("\n").trim();
    errors.push(...validateCommitSubjects([subject]));
    if (body && !CHINESE_TEXT.test(body)) {
      errors.push(`Commit body must include 简体中文: ${subject}`);
    }
  }

  return errors;
}

function main() {
  const { base, head } = parseReviewRangeArguments(process.argv.slice(2), "validate-commits.mjs");
  const messages = execFileSync("git", ["log", "--format=%B%x00", `${base}..${head}`], {
    encoding: "utf8",
  })
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);
  const errors = validateCommitMessages(messages);

  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
