import {
  customFieldDefinitionListQuerySchema,
  settingEntityListQuerySchema,
} from "@novel-brain/contracts";
import { describe, expect, it } from "vitest";

import { buildQueryParameters } from "../src/common/zod-openapi";

describe("Zod OpenAPI query parameters", () => {
  it("derives setting list query parameters from the shared contract", () => {
    expect(buildQueryParameters(settingEntityListQuerySchema)).toMatchObject([
      { name: "cursor", required: false, schema: { type: "string" } },
      {
        name: "limit",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      { name: "type", required: false, schema: { type: "string" } },
      { name: "status", required: false, schema: { type: "string" } },
    ]);
  });

  it("derives custom-field query parameters from the shared contract", () => {
    expect(buildQueryParameters(customFieldDefinitionListQuerySchema)).toMatchObject([
      { name: "cursor", required: false, schema: { type: "string" } },
      {
        name: "limit",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    ]);
  });
});
