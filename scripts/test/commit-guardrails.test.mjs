import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { validateCommitMessages, validateCommitSubjects } from "../validate-commits.mjs";
import { resolveGuardrailBase } from "../check-pr-guardrails.mjs";
import { commitFile, runGit, runNode, withRepository } from "./git-fixtures.mjs";

const commitScript = fileURLToPath(new URL("../validate-commits.mjs", import.meta.url));

test("accepts Chinese Conventional Commit subjects", () => {
  assert.deepEqual(validateCommitSubjects(["feat(scope): 增加发布校验", "fix: 修正快照链"]), []);
});

test("accepts a breaking Conventional Commit subject", () => {
  assert.deepEqual(validateCommitSubjects(["feat(api)!: 删除旧接口"]), []);
});

test("rejects malformed and English-only commit subjects", () => {
  const errors = validateCommitSubjects([
    'Revert "feat: old behavior"',
    "feat(scope): add release guard",
  ]);

  assert.equal(errors.length, 3);
  assert.match(errors.join("\n"), /Conventional Commits/);
  assert.match(errors.join("\n"), /简体中文/);
});

test("rejects an English description even when the scope contains Chinese", () => {
  const errors = validateCommitSubjects(["feat(中文): add release guard"]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /简体中文/);
});

test("rejects English prose containing a single Chinese character", () => {
  const errors = validateCommitSubjects(["fix: remove 中"]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /简体中文/);
});

test("rejects an English-majority subject with an embedded Chinese word", () => {
  const errors = validateCommitSubjects(["feat: add 中文 support"]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /简体中文/);
});

test("rejects English prose wrapped around a Chinese word", () => {
  const errors = validateCommitSubjects(["fix: fix修正bug"]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /简体中文/);
});

test("rejects an unknown English word beside Chinese text", () => {
  assert.match(
    validateCommitSubjects(["feat: 中文 add"]).join("\n"),
    /subject must include 简体中文/,
  );
  assert.match(
    validateCommitMessages(["feat: 增加校验\n\n中文 abcdefghijk"]).join("\n"),
    /body must include 简体中文/,
  );
});

test("allows recognized technical words in Chinese prose", () => {
  assert.deepEqual(
    validateCommitMessages([
      "feat: 增加 OpenAPI 输出\n\n- 更新 Vitest 与 Playwright 校验\n- 固定 origin 与 base 范围\n- 使用 release 与 Git ref resolver\n- 校验 provenance 与 Merge pull request subject",
    ]),
    [],
  );
});

test("allows PascalCase and camelCase project identifiers", () => {
  assert.deepEqual(
    validateCommitSubjects([
      "feat: 更新 NovelBrain 配置",
      "refactor: 更新 StoryFact 投影",
      "fix: 修复 TypeScript 类型",
    ]),
    [],
  );
});

test("rejects Traditional Chinese commit subjects", () => {
  const errors = validateCommitSubjects(["fix: 修正錯誤"]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /简体中文/);
});

test("requires a Chinese commit body when a body is present", () => {
  assert.match(
    validateCommitMessages(["feat: 增加校验\n\n- add release guard"]).join("\n"),
    /body must include 简体中文/,
  );
  assert.deepEqual(validateCommitMessages(["feat: 增加校验\n\n- 增加发布护栏"]), []);
});

test("rejects an English-majority commit body", () => {
  assert.match(
    validateCommitMessages(["feat: 增加校验\n\nThis guard adds 中文 support for releases"]).join(
      "\n",
    ),
    /body must include 简体中文/,
  );
});

test("validates merge commit messages in the PR range", () => {
  withRepository((repository) => {
    const base = commitFile(repository, {
      name: "root.txt",
      content: "root\n",
      message: "feat: 根提交",
    });

    runGit(repository, ["checkout", "-b", "side"]);
    commitFile(repository, {
      name: "side.txt",
      content: "side\n",
      message: "feat: 侧支提交",
    });

    runGit(repository, ["checkout", "-b", "main", base]);
    commitFile(repository, {
      name: "main.txt",
      content: "main\n",
      message: "feat: 主线提交",
    });
    runGit(repository, ["merge", "--no-ff", "side", "-m", "Merge branch 'side'"]);

    const result = runNode(repository, commitScript, ["--base", base, "--head", "HEAD"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Merge branch 'side'/);
  });
});

test("allows GitHub-generated merge commits", () => {
  assert.deepEqual(
    validateCommitMessages([
      "Merge pull request #169 from ruifeng-y/codex/agent-guardrails\n\nGuardrails",
    ]),
    [],
  );
});

test("accepts a PR range with multiple Chinese commits", () => {
  withRepository((repository) => {
    const base = commitFile(repository, {
      name: "root.txt",
      content: "root\n",
      message: "feat: 根提交",
    });
    commitFile(repository, {
      name: "first.txt",
      content: "first\n",
      message: "feat: 第一个提交",
    });
    commitFile(repository, {
      name: "second.txt",
      content: "second\n",
      message: "fix: 第二个提交",
    });

    const result = runNode(repository, commitScript, ["--base", base, "--head", "HEAD"]);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("uses the committed baseline to skip historical non-compliant commits", () => {
  withRepository((repository) => {
    const base = commitFile(repository, {
      name: "root.txt",
      content: "root\n",
      message: "feat: 根提交",
    });
    const baseline = commitFile(repository, {
      name: "legacy.txt",
      content: "legacy\n",
      message: "legacy english commit",
    });
    const head = commitFile(repository, {
      name: "head.txt",
      content: "head\n",
      message: "fix: 新提交",
    });

    assert.equal(
      resolveGuardrailBase({
        baseSha: base,
        headSha: head,
        baselineSha: baseline,
        cwd: repository,
      }),
      baseline,
    );
    assert.equal(
      resolveGuardrailBase({
        baseSha: base,
        headSha: head,
        baselineSha: undefined,
        cwd: repository,
      }),
      base,
    );
  });
});
