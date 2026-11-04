---
Status: accepted
---

# Full economy transaction engine is post-V1

## Context

V1 models world facts, items, resources, equipment and their rights because those are required for narrative continuity. A complete economic simulation is a materially larger subsystem: currencies, accounts, exchange, production, pricing, markets and auditable transactions. Treating item ownership as if it already provided an economy engine would overstate the current scope.

## Decision

- V1 includes typed item/resource/equipment/asset facts and distinct rights where needed by the story domain: ownership, custody, location, usage and disposal.
- V1 does not include a general economic transaction engine, world currency accounts, exchange rates, dynamic pricing, markets, production chains, supply/demand simulation, trade settlement or an economy-agent workflow.
- The complete economy engine is retained as post-V1 product scope in docs/planning/post-v1-scope-register.md.
- The future design must support per-world currency systems and configurable media/forms of value, event-sourced transactions, asset and resource ledgers, dynamic pricing policies, production/consumption/trade, and explicit separation of ownership/custody/location/usage/disposal rights.
- Economic Agents must be bounded by explicit grants and pre-authorized value/risk limits. Proposals must remain proposals until a permitted transaction is atomically committed and audited. Agents cannot grant themselves new financial or world-economy permissions.
- This ADR does not introduce V1 database tables, routes, UI pages or capability IDs for the deferred engine.

## Consequences

- V1 can validate story continuity around resource identity and rights without pretending to simulate a complete economy.
- V1 acceptance and the 10M/continuity benchmarks must not claim economic simulation or transactional market behavior.
- Adding the engine requires a separate domain specification, ledger invariants, authorization policy, issue decomposition and deterministic simulation tests.

## Scope register

See docs/planning/post-v1-scope-register.md.
