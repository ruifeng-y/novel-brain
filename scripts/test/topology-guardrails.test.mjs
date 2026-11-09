import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { headAncestorOfBaseError } from "../validate-pr-topology.mjs";
import { commitFile, runGit, runNode, withRepository } from "./git-fixtures.mjs";

const topologyScript = fileURLToPath(new URL("../validate-pr-topology.mjs", import.meta.url));

test("describes the head-ancestor topology violation", () => {
  assert.match(
    headAncestorOfBaseError({
      base: "base-sha",
      head: "head-sha",
      headIsAncestorOfBase: true,
    }),
    /head-sha is an ancestor of base-sha/,
  );
  assert.equal(
    headAncestorOfBaseError({
      base: "base-sha",
      head: "head-sha",
      headIsAncestorOfBase: false,
    }),
    null,
  );
});

test("rejects a PR whose head is an ancestor of its base", () => {
  withRepository((repository) => {
    const base = commitFile(repository, {
      name: "base.txt",
      content: "base\n",
      message: "feat: 基准提交",
    });
    const head = commitFile(repository, {
      name: "feature.txt",
      content: "feature\n",
      message: "feat: 功能提交",
    });

    const forward = runNode(repository, topologyScript, ["--base", base, "--head", head]);
    assert.equal(forward.status, 0, forward.stderr);

    const reverse = runNode(repository, topologyScript, ["--base", head, "--head", base]);
    assert.equal(reverse.status, 1);
    assert.match(reverse.stderr, /must not be an ancestor/);
  });
});

test("accepts a PR when its base advances after the head diverges", () => {
  withRepository((repository) => {
    const root = commitFile(repository, {
      name: "root.txt",
      content: "root\n",
      message: "feat: 根提交",
    });

    runGit(repository, ["checkout", "-b", "feature"]);
    const head = commitFile(repository, {
      name: "feature.txt",
      content: "feature\n",
      message: "feat: 功能提交",
    });

    runGit(repository, ["checkout", "-b", "main", root]);
    const base = commitFile(repository, {
      name: "base.txt",
      content: "base\n",
      message: "feat: 基准前进",
    });

    const result = runNode(repository, topologyScript, ["--base", base, "--head", head]);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("accepts an empty local range at the same commit", () => {
  withRepository((repository) => {
    const root = commitFile(repository, {
      name: "root.txt",
      content: "root\n",
      message: "feat: 根提交",
    });

    const result = runNode(repository, topologyScript, ["--base", root, "--head", root]);
    assert.equal(result.status, 0, result.stderr);
  });
});
