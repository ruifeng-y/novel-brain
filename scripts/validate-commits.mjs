import { execFileSync } from "node:child_process";

import { Converter } from "opencc-js";

import { runCli } from "./cli-entry.mjs";
import { parseReviewRangeArguments } from "./review-range-arguments.mjs";

const CONVENTIONAL_SUBJECT =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)]+\))?!?: (.+)$/;
const HAN_TEXT = /[\u3400-\u9fff]/g;
const toSimplified = Converter({ from: "t", to: "cn" });

function isSimplifiedChineseProse(text, minimumHanRatio) {
  const hanCount = text.match(HAN_TEXT)?.length ?? 0;
  const latinCount = text.match(/[a-z]/gi)?.length ?? 0;
  const hanRatio = hanCount / Math.max(hanCount + latinCount, 1);

  return hanCount >= 2 && hanRatio >= minimumHanRatio && toSimplified(text) === text;
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
