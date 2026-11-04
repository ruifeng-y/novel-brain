# Post-V1 Product Scope Register

> Status: accepted scope boundary for V1 planning.
> Authority: ADR 0025 and ADR 0026.
> Purpose: preserve previously established product direction without silently expanding V1 or losing requirements between releases.

## 1. Scope rules

- Items in this register are intentionally outside V1. They do not block M0–M3 or V1 release.
- A post-V1 item is not an implementation-ready ticket. Before implementation it requires a versioned product requirement, capability IDs, ADRs where architecture decisions are needed, leaf issues, UI contracts and acceptance tests.
- V1 must not ship fake, partial or misleading controls that imply these capabilities are available.
- Deferral does not authorize incompatible shortcuts in V1. Existing immutable revisions, actor attribution, typed resource identity and rights separation should remain usable as foundations, but V1 must not build speculative infrastructure without a concrete contract.

## 2. Same-chapter real-time collaboration

**Status:** Post-V1; explicitly excluded from V1.

Retained product outcome: multiple authorized users can edit the same chapter concurrently in one shared work, observe one another's presence/cursors and see changes propagate without overwriting accepted edits.

Future requirements to specify:

- Workspace/work membership, invitations, identity, roles and resource-level authorization.
- Same-chapter concurrent editing protocol; compare OT and CRDT against the editor's content model and persistence needs before selecting one.
- Presence, cursor/selection awareness, collaborator attribution and connection state.
- Autosave, operation ordering, reconnect, offline edits and deterministic conflict recovery.
- Chapter/revision history that preserves actor attribution and provides an auditable result after concurrent edits.
- Integration with chapter locking, review submissions, branch heads, immutable revisions and high-risk canon gates.
- Permission revocation during an active editing session and isolation across workspaces/works.
- Multi-client E2E tests covering races, disconnects, duplicate/out-of-order operations, stale clients and authorization failures.

Not included in V1: WebSocket collaboration sessions, multi-cursor presence, shared editing permissions, live co-editing or team roles.

## 3. Full story-world economy engine

**Status:** Post-V1; explicitly excluded from V1. V1's typed resource/item rights remain in scope.

Retained product outcome: worlds can model economic systems consistently and Agents can execute only permitted economic operations.

Future requirements to specify:

- Per-world currencies, denominations, conversion rules and supported value media/forms.
- Typed economic accounts, balances and asset/resource ledgers with atomic, append-only transaction events.
- Ownership, custody, location, usage rights and disposal rights as separate dimensions.
- Production, gathering, crafting, consumption, loss, transfer, theft, loan, inheritance, trade and settlement.
- Dynamic pricing policies, supply/demand, market participants, regional/temporal price variation and reproducible price decisions.
- Public, institutional, community and open-access assets, with explicit access and disposal policies.
- Economic timeline and audit views that can be queried at a story branch/version point.
- Agent permissions constrained by world, account/resource whitelist, transaction type, value range, risk, budget and expiry.
- Proposal and execution separation: a proposed transaction does not alter balances or ownership; commit must be permission-checked, atomic, idempotent and recorded in the economic event ledger.
- Deterministic simulation fixtures for conservation, duplicate settlement, insufficient funds/resources, price-policy changes, branch isolation and rollback/compensation.

Not included in V1: general ledger/accounting engine, currency exchange, dynamic market pricing, production-chain simulation, trade settlement or autonomous economic execution.

## 4. V1 boundaries and existing foundations

| Capability | V1 treatment | Post-V1 treatment |
|---|---|---|
| Individual authors and separate personal works | Included | May be extended to shared workspaces |
| Teams, memberships and work sharing | Excluded | Required for collaboration |
| Same-chapter multi-user live editing | Excluded | Retained |
| Typed items/resources/equipment/assets | Included where required by story domain | Extended by economy |
| Ownership/custody/location/usage/disposal rights | Included as story-state rights | Reused by transaction ledger |
| Currencies, accounts and dynamic pricing | Excluded | Retained |
| Production, trade and settlement engine | Excluded | Retained |
| Bounded Agent grants and audit | Included for V1 writing tools | Extended to economic operations |

## 5. No new V1 release blockers

Neither item creates a V1 capability ID or dependency edge. The V1 capability manifest and release scope remain unchanged. Revisit this register only when the product explicitly enters post-V1 planning or a genuine V1 requirement gap is discovered.
