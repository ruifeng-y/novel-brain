---
Status: accepted
---

# Same-chapter real-time collaboration is post-V1

## Context

The product direction includes multiple people editing the same chapter at the same time. The current V1 baseline, however, is explicitly designed for individual authors: no teams, memberships, invitations, shared-work permissions or role matrix. Shipping a partial presence indicator or a shared editor without conflict-safe persistence would create a misleading collaboration promise.

## Decision

- V1 remains a single-owner authoring workspace. Multiple registered users may each own separate works, but a work is not shared with other accounts.
- Concurrent multi-user editing of the same chapter is a post-V1 capability. It is not a V1 acceptance criterion and must not be represented by prototype-only or mocked production behavior.
- The post-V1 capability is retained in the product scope register; this is a deferral, not a deletion of the product direction.
- A future implementation proposal must separately specify workspace/membership authorization, per-resource permissions, presence, concurrent text operations, reconnect/offline behavior, conflict recovery, audit attribution and version/checkpoint semantics.
- The future collaboration design must compare OT and CRDT approaches against the actual manuscript editor and persistence model. This ADR does not prematurely select a collaboration protocol or library.
- V1 keeps actor attribution and immutable chapter/revision history. The V1 owner model must not be bypassed by an ad-hoc shared-user list or client-side authorization.

## Consequences

- V1 can be implemented and released without a second authorization system or real-time collaboration infrastructure.
- Same-chapter multi-user editing cannot be claimed as delivered in V1.
- Reintroducing collaboration requires a dedicated ADR, capability IDs, bounded issues, security review and multi-client E2E tests before implementation.

## Scope register

See docs/planning/post-v1-scope-register.md.
