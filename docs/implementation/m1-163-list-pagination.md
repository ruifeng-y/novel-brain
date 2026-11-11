# M1 #163 GET list pagination audit

Status: implemented.

All top-level GET collection endpoints use the shared `cursorPageQuerySchema` (or a strict
`.extend(...)` of it) and `meta.nextCursor`. SQL queries use a stable sort key, fetch
`limit + 1`, return at most `limit` rows, reject unknown query keys such as `offset`, and
reject a cursor that does not belong to the same tenant/resource scope.

| Endpoint | Status | Stable order |
| --- | --- | --- |
| `GET /api/v1/auth/sessions` | paginated | `createdAt DESC, id DESC` |
| `GET /api/v1/users/me/pen-names` | paginated | `isDefault DESC, updatedAt DESC, id DESC` |
| `GET /api/v1/model-configs` | paginated | `isDefault DESC, updatedAt DESC, id DESC` |
| `GET /api/v1/works` | paginated | `id DESC` |
| `GET /api/v1/works/:workId/branches` | paginated | `createdAt DESC, id DESC` |
| `GET /api/v1/works/:workId/branches/:branchId/story-bible/versions` | paginated | existing version cursor |
| `GET /api/v1/works/:workId/branches/:branchId/story-bible/world-rules` | paginated | existing world-rule cursor |
| `GET /api/v1/works/:workId/branches/:branchId/entities` | paginated | existing setting cursor |
| `GET /api/v1/works/:workId/branches/:branchId/entities/:entityId/versions` | paginated | existing version cursor |
| `GET /api/v1/works/:workId/branches/:branchId/entities/:entityId/proposals` | paginated | existing proposal cursor |
| `GET /api/v1/works/:workId/branches/:branchId/entities/:entityId/change-requests` | paginated | existing change-request cursor |
| `GET /api/v1/works/:workId/branches/:branchId/settings/custom-fields` | paginated | existing custom-field cursor |
| `GET /api/v1/works/:workId/branches/:branchId/facts` | paginated | `id ASC` across locked entities and canon facts |
| `GET /api/v1/works/:workId/branches/:branchId/characters` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/characters/:characterId/change-requests` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/world/factions` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/world/maps` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/world/power-systems` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/world/mechanisms` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/world/items` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/chapters` | paginated | `number ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/versions` | paginated | `version DESC, id DESC` |
| `GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/fact-proposals` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/write-actions` | paginated | existing writing-action cursor |
| `GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/annotations` | paginated | `createdAt DESC, id DESC` |
| `GET /api/v1/works/:workId/branches/:branchId/chapters/:chapterId/revisions` | paginated | existing revision cursor |
| `GET /api/v1/works/:workId/branches/:branchId/canon/commits` | paginated | existing canon cursor |
| `GET /api/v1/works/:workId/branches/:branchId/generation/jobs` | paginated | `createdAt DESC, id DESC` |
| `GET /api/v1/works/:workId/branches/:branchId/agent-grants` | paginated | `createdAt ASC, id ASC` |
| `GET /api/v1/works/:workId/branches/:branchId/agent-runs` | paginated | `id ASC` (existing) |

The following responses embed multiple collections inside one compound document. They are not
top-level list endpoints and therefore keep their aggregate response shape:

- `GET /api/v1/works/:workId/branches/:branchId/world/timeline` returns eras, events and
  itineraries as one timeline document.
- `GET /api/v1/works/:workId/branches/:branchId/ledger` returns one story-ledger workspace.
- `GET /api/v1/works/:workId/branches/:branchId/world/snapshot` returns one world snapshot.
- `GET /api/v1/model-configs/providers` is a bounded static provider catalog, not a
  tenant-owned resource collection.

## Consumer rule

When a screen needs the complete collection, it must call `fetchAllCursorPages` in
`apps/web/lib/cursor-pagination.ts` or advance its own cursor until `meta.nextCursor` is null.
A Web consumer must not treat the first `data` page as the complete collection.

## Evidence

- Contract tests: `pnpm exec vitest run packages/contracts/test/contracts.test.ts packages/contracts/test/pagination-contracts.test.ts` passed, 65 tests.
- Pagination integration: `pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/list-pagination.integration.test.ts` passed, covering empty page, first/last page, cursor past the last item, invalid cursor, tenant isolation, and concurrent inserts before/after the cursor.
- Affected API integration batches: 44, 76, and 94 tests passed across auth, works, characters, chapters, facts, generation, agent runtime, quality, settings, world, writing actions, revisions, and story bible.
- OpenAPI: `pnpm --filter @novel-brain/api openapi:check` passed after regenerating `openapi.json` and `src/generated/openapi.d.ts`.
