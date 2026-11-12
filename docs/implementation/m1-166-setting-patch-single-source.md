# M1 #166 generic setting PATCH single-source enforcement

Status: implemented.

The generic `PATCH /entities/:entityId` contract now accepts domain `data` only for
`world_rule`. Character, faction, map, power-system, golden-finger, item and timeline data
must use their dedicated APIs.

The API resolves the current entity before parsing the patch. If a dedicated-domain entity
receives `data`, it returns the stable `SETTING_DOMAIN_DATA_FORBIDDEN` error instead of
falling through to a generic validation error. The repository repeats the type guard before
writing `entities.attributes`, so the JSONB write boundary cannot be bypassed by an internal
caller.

The Settings Center already routes first-class domain edits through the dedicated character,
world, power/item and timeline endpoints. Generic entity PATCH is now used only for common
metadata, custom fields, locking, restoration and world-rule data.

Golden-finger and item version snapshots now persist their dedicated-table domain state.
Restoration writes both the entity projection and the dedicated row, so subsequent list and
detail reads return the restored version rather than the value being replaced.

## Evidence

- Contract coverage: `packages/contracts/test/contracts.test.ts` rejects all seven dedicated
  domain payloads while retaining world-rule data.
- API integration coverage: `apps/api/test/settings.integration.test.ts` verifies stable
  forbidden errors across character, faction, map, power-system, golden-finger, item and
  timeline entities, then verifies dedicated updates and restoration in list, detail and
  version history, including golden-finger and item structural fields.
- OpenAPI reflects a world-rule-only generic `data` payload.
