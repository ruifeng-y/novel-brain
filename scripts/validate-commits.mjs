import { execFileSync } from "node:child_process";

import { Converter } from "opencc-js";

import { runCli } from "./cli-entry.mjs";
import { parseReviewRangeArguments } from "./review-range-arguments.mjs";

const CONVENTIONAL_SUBJECT =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)]+\))?!?: (.+)$/;
const HAN_TEXT = /[\u3400-\u9fff]/g;
const LATIN_WORD = /[A-Za-z][A-Za-z0-9]*/g;
const TECHNICAL_WORDS = new Set([
  "api",
  "app",
  "base",
  "breaking",
  "check",
  "ci",
  "cli",
  "commit",
  "compose",
  "conventional",
  "db",
  "devpreinstall",
  "docker",
  "drift",
  "eslint",
  "git",
  "github",
  "guardrail",
  "guardrails",
  "head",
  "http",
  "https",
  "idx",
  "journal",
  "json",
  "lockfile",
  "main",
  "migration",
  "node",
  "npm",
  "openapi",
  "opencc",
  "origin",
  "playwright",
  "pnpm",
  "postgres",
  "powershell",
  "pr",
  "preflight",
  "prettier",
  "production",
  "push",
  "redis",
  "ref",
  "release",
  "resolver",
  "review",
  "sha",
  "snapshot",
  "sql",
  "tag",
  "test",
  "tests",
  "topology",
  "url",
  "validator",
  "vitest",
  "web",
  "worker",
  "wsl",
  "yaml",
]);
const toSimplified = Converter({ from: "t", to: "cn" });

function isSimplifiedChineseProse(text, minimumHanRatio) {
  const hanCount = text.match(HAN_TEXT)?.length ?? 0;
  const latinCount = text.match(/[a-z]/gi)?.length ?? 0;
  const hanRatio = hanCount / Math.max(hanCount + latinCount, 1);
  const textWithoutCode = text.replace(/`[^`]*`/g, "");
  const usesOnlyKnownEnglish = [...textWithoutCode.matchAll(LATIN_WORD)]
    .filter(([word]) => word.length > 1)
    .every(
      ([word]) =>
        /^[A-Z][A-Z0-9]*$/.test(word) ||
        /[a-z][A-Z]/.test(word) ||
        TECHNICAL_WORDS.has(word.toLowerCase()),
    );

  return (
    hanCount >= 2 &&
    hanRatio >= minimumHanRatio &&
    toSimplified(text) === text &&
    usesOnlyKnownEnglish
  );
}

export function validateCommitSubjects(subjects) {
  const errors = [];

  for (const subject of subjects) {
    const match = CONVENTIONAL_SUBJECT.exec(subject);
    if (!match) {
      errors.push(`Commit subject is not Conventional Commits: ${subject}`);
    }
    if (!isSimplifiedChineseProse(match?.[1] ?? "", 0.2)) {
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
    if (body && !isSimplifiedChineseProse(body, 0.15)) {
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

runCli(import.meta.url, process.argv[1], main, 2);
