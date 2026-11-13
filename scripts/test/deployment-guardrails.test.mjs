import assert from "node:assert/strict";
import { test } from "vitest";

import { validateDeploymentAssets } from "../deployment-guardrails.mjs";

test("keeps deployment, observability and rollback assets aligned", () => {
  assert.deepEqual(validateDeploymentAssets(), []);
});
