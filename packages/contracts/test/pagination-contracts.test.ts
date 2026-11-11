import { describe, expect, it } from "vitest";
import type { z } from "zod";

import * as contractsModule from "../src";

const contracts = contractsModule as unknown as Record<string, z.ZodType>;
const cursor = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c99";

const paginatedListContracts = [
  {
    endpoint: "GET /api/v1/auth/sessions",
    querySchema: "authDeviceSessionsQuerySchema",
    responseSchema: "authDeviceSessionsResponseSchema",
  },
  {
    endpoint: "GET /api/v1/users/me/pen-names",
    querySchema: "authorPenNameListQuerySchema",
    responseSchema: "authorPenNameListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/model-configs",
    querySchema: "modelConfigListQuerySchema",
    responseSchema: "modelConfigsResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works",
    querySchema: "workListQuerySchema",
    responseSchema: "workListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches",
    querySchema: "workBranchListQuerySchema",
    responseSchema: "workBranchesResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/story-bible/versions",
    querySchema: "storyBibleVersionListQuerySchema",
    responseSchema: "storyBibleVersionListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/story-bible/world-rules",
    querySchema: "storyBibleWorldRuleListQuerySchema",
    responseSchema: "storyBibleWorldRuleListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/settings/custom-fields",
    querySchema: "customFieldDefinitionListQuerySchema",
    responseSchema: "customFieldDefinitionListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/entities",
    querySchema: "settingEntityListQuerySchema",
    responseSchema: "settingEntityListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/entities/:entityId/versions",
    querySchema: "settingEntityVersionListQuerySchema",
    responseSchema: "settingEntityVersionListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/entities/:entityId/proposals",
    querySchema: "settingProposalListQuerySchema",
    responseSchema: "settingProposalListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/entities/:entityId/change-requests",
    querySchema: "settingChangeRequestListQuerySchema",
    responseSchema: "settingChangeRequestListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/facts",
    querySchema: "confirmedSettingListQuerySchema",
    responseSchema: "confirmedSettingListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/characters",
    querySchema: "characterListQuerySchema",
    responseSchema: "characterListResponseSchema",
  },
  {
    endpoint:
      "GET /api/v1/works/:workId/branches/:branchId/characters/:characterId/change-requests",
    querySchema: "characterChangeRequestListQuerySchema",
    responseSchema: "characterChangeRequestListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/world/factions",
    querySchema: "factionListQuerySchema",
    responseSchema: "factionListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/world/maps",
    querySchema: "mapListQuerySchema",
    responseSchema: "mapListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/world/power-systems",
    querySchema: "powerSystemListQuerySchema",
    responseSchema: "powerSystemListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/world/mechanisms",
    querySchema: "specialMechanismListQuerySchema",
    responseSchema: "specialMechanismListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/world/items",
    querySchema: "itemListQuerySchema",
    responseSchema: "itemListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/chapters",
    querySchema: "chapterListQuerySchema",
    responseSchema: "chapterWorkspaceListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/versions",
    querySchema: "chapterVersionListQuerySchema",
    responseSchema: "chapterVersionListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/fact-proposals",
    querySchema: "factProposalListQuerySchema",
    responseSchema: "factProposalListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/canon/commits",
    querySchema: "canonCommitListQuerySchema",
    responseSchema: "canonCommitListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/generation/jobs",
    querySchema: "generationJobListQuerySchema",
    responseSchema: "generationJobListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/write-actions",
    querySchema: "writingActionJobListQuerySchema",
    responseSchema: "writingActionJobListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/agent-grants",
    querySchema: "agentGrantListQuerySchema",
    responseSchema: "agentGrantListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/agent-runs",
    querySchema: "agentRunTraceListQuerySchema",
    responseSchema: "agentRunTraceListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/annotations",
    querySchema: "criticAnnotationListQuerySchema",
    responseSchema: "criticAnnotationListResponseSchema",
  },
  {
    endpoint: "GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/revisions",
    querySchema: "revisionPlanListQuerySchema",
    responseSchema: "revisionPlanWorkspaceListResponseSchema",
  },
] as const;

describe("cursor pagination contracts", () => {
  it.each(paginatedListContracts)(
    "uses the shared cursor contract for $endpoint",
    ({ querySchema: querySchemaName, responseSchema: responseSchemaName }) => {
      const querySchema = contracts[querySchemaName];
      expect(querySchema, `${querySchemaName} must be exported`).toBeDefined();
      const requiresChapter = querySchemaName === "generationJobListQuerySchema";
      const expectedDefault =
        querySchemaName === "storyBibleWorldRuleListQuerySchema"
          ? 100
          : querySchemaName === "agentRunTraceListQuerySchema"
            ? 50
            : 20;
      expect(querySchema.parse(requiresChapter ? { chapterId: cursor } : {})).toEqual(
        requiresChapter
          ? { chapterId: cursor, limit: expectedDefault }
          : { limit: expectedDefault },
      );
      expect(
        querySchema.parse({
          ...(requiresChapter ? { chapterId: cursor } : {}),
          cursor,
          limit: "2",
        }),
      ).toEqual({
        ...(requiresChapter ? { chapterId: cursor } : {}),
        cursor,
        limit: 2,
      });
      expect(querySchema.safeParse({ offset: 0 }).success).toBe(false);

      const responseSchema = contracts[responseSchemaName];
      expect(responseSchema, `${responseSchemaName} must be exported`).toBeDefined();
      expect(responseSchema.safeParse({ data: [], requestId: "req_pagination" }).success).toBe(
        false,
      );
      expect(
        responseSchema.parse({
          data: [],
          requestId: "req_pagination",
          meta: { nextCursor: null },
        }),
      ).toEqual({
        data: [],
        requestId: "req_pagination",
        meta: { nextCursor: null },
      });
    },
  );
});
