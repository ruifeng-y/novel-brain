# M1-02a 人物、关系与角色知识状态域模型

> Issue: #106 — [M1-02a] 人物、关系与角色知识状态域模型
> Branch: `codex/m1-106`
> Status: implementation complete; production UI golden awaits author sign-off.

## Scope delivered

- Added reusable shared contracts for `DomainRef`, version references, story-time points and validity intervals so #107/#108 can consume one contract.
- Added dedicated character tables for profiles, typed relationship edges, body/limb/location/ability/disguise transitions, knowledge/belief/suspicion/misbelief/unknown states, and locked-content change requests.
- Kept objective canon in `facts`; character knowledge stores only a fact reference plus the character's subjective state.
- Reused the single version graph. Character writes append `version_nodes` and `entity_versions` snapshots.
- Added NestJS character APIs under `/works/:workId/branches/:branchId/characters`.
- Connected settings/entity-detail to the dedicated character API and added profile, relationship, state-history, knowledge/reference and health sections.

## Migrations and schema

- `packages/db/migrations/0025_nostalgic_ma_gnuci.sql`
- `packages/db/src/schema.ts`

All five new tenant tables enable and force row-level security with the existing `app.user_id` policy pattern. Existing character entities are backfilled into `character_profiles`.

## Contracts and invariants

- `packages/contracts/test/contracts.test.ts`
- `packages/core/test/core.test.ts`
- `apps/api/test/characters.integration.test.ts`

The tests cover:

- strict versioned domain references and validity intervals;
- characters cannot read undisclosed objective facts;
- belief/misbelief/suspicion do not mutate objective canon;
- chapter and version replay for body, location, ability and relationships;
- state interval overlap rejection;
- lock-to-change-request flow;
- cross-tenant denial and RLS enablement.

## UI evidence

- `apps/web/e2e/parity/entity-detail.spec.ts`

Playwright runs loading, empty, error, locked, proposal and long states at `390`, `900`, `1180` and `1440` CSS pixels. Attachments use `entity-detail-{profile|empty|error|locked|proposal|long}-{width}` names. Production golden screenshots remain pending author sign-off under `docs/ui/production-visual-regression.md`.
