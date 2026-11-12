# V1 Tenant RLS and Authorization Audit

> Issue: #132
> Scope: M0–M2 tenant-owned tables
> Inventory: `docs/security/tenant-rls-inventory.json`
> Command: `pnpm audit:tenant-rls --output docs/security/tenant-rls-inventory.json`

## Inventory Rule

Every `public` table containing `user_id`, `work_id` or `branch_id` is treated as tenant-owned. A table is covered only when:

- RLS is enabled;
- RLS is forced;
- at least one policy exists;
- the policy references the table's ownership key.

The inventory command exits non-zero when any table is uncovered. CI also runs `apps/api/test/tenant-rls.integration.test.ts`.

## Closed Findings

The first audit found five uncovered tables. Migration `0056_tenant_rls_audit.sql` adds forced RLS and tenant policies to:

- `model_configs`
- `password_resets`
- `pen_names`
- `sessions`
- `search_rebuild_runs`

`search_rebuild_runs` required a forward migration because the policy was added to an already-applied migration during M2 development. Existing environments are corrected by `0056`.

## Authorization Evidence Matrix

| Surface | Evidence | Status |
| --- | --- | --- |
| Public API cross-user reads/writes | `apps/api/test/*.integration.test.ts`, including M2 change/search/import tests | covered |
| Search isolation | `apps/api/test/m2-04-06.integration.test.ts` | covered |
| Worker/Agent tenant context | `apps/api/test/agent-runtime.integration.test.ts` | covered |
| Missing user context fails closed | `apps/api/test/tenant-rls.integration.test.ts` | covered |
| Transaction-local context does not leak | `apps/api/test/tenant-rls.integration.test.ts` | covered |
| Auth/session/pen-name/model key access | `apps/api/test/auth.integration.test.ts` | covered |
| Rate-limit and privilege escalation | `apps/api/test/auth.integration.test.ts`, `agent-runtime.integration.test.ts` | covered |
| Exports/object storage | No production export or object-storage tables exist in M2; must be added by #129/#134/#136 | pending dependent scope |

## Audit Rules

- New tenant tables must update the inventory in the same PR.
- A migration already applied to an environment must not be edited to add a new security guarantee; add a forward migration.
- Missing `app.user_id` must return no tenant rows or fail the mutation, never fall back to all rows.
- A parent authorization check does not replace row-level policy coverage.
