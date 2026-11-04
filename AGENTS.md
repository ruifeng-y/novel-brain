# Agent execution policy

## Product and source of truth
This repository is the active NovelBrain product. Implement only approved scope recorded in GitHub Issues and the documents referenced by those issues.

Before implementation:
1. Read GLOSSARY.md.
2. Read relevant accepted ADRs in docs/adr/.
3. Read relevant requirements, technical contracts, UI contract and parity-matrix rows.
4. Read docs/implementation/README.md and docs/planning/implementation-frontier.md.
5. Fetch the exact GitHub issue and state its title before changing code.

Authority order:
1. Accepted ADRs for decisions and invariants.
2. docs/requirements/v1-requirements.md for product behavior.
3. docs/technical/nestjs-backend-design.md and docs/technical/m0-protocol-freeze.md for architecture and protocol contracts.
4. docs/ui/prototype-contract.md, docs/ui/v1-prototype-signoff.md, and docs/ui/v1-ui-parity-matrix.md for UI behavior and acceptance.
5. Capability Manifest and Traceability for coverage and mapping.
6. GitHub implementation tickets for the bounded work unit and acceptance evidence.

If two sources conflict, stop the affected work and report the conflict. Do not choose silently, invent a product decision, or edit an accepted ADR without explicit approval.

## Implementation workflow
- Use /implement #<issue-number> for one bounded ticket at a time. Do not implement a milestone parent spec as one ticket.
- Follow docs/implementation/README.md and the dependency frontier. Do not start a blocked ticket.
- Use the tdd skill at agreed public seams where possible; run targeted tests and typechecks during implementation.
- After implementation, use the code-review skill, resolve findings, run the full relevant suite, and commit on the current implementation branch.
- Never claim a ticket is complete without concrete test, UI parity, security, or benchmark evidence required by its acceptance criteria.
- Keep changes within the ticket. If a missing requirement or cross-ticket contract is found, stop and raise a scoped issue.

## Architecture guardrails
- Web calls the NestJS HTTP API only. Web must not access the database or model providers directly.
- Worker consumes typed durable jobs; it is not an HTTP API.
- Shared Zod contracts are the source for Web/API/Worker request and event types.
- PostgreSQL is the durable source of truth; Redis/BullMQ is transport and scheduling, not authoritative job state.
- All mutations are tenant-scoped and authorization is enforced at the API boundary.
- AI agents cannot directly commit authoritative story facts or bypass human gates.
- Chapter approval, fact decisions and story-fact submission remain separate state transitions.
- Version history is append-only through the single version graph. Rollback creates a new node.
- Cost limits, idempotency, checkpoints, auditability and recoverability are required for long-running generation.

## UI guardrails
- Production UI follows the signed-off prototype and parity matrix. Do not redesign, simplify, omit page states, or replace real actions with Toast-only mock actions.
- Every UI ticket references a parity-matrix page and capability IDs.
- Keep author-facing language; internal implementation terms belong in code and engineering docs only.
- Prototype-only controls never ship in production.
- Any approved deviation must update the prototype contract, parity matrix and sign-off record before implementation.

## Security and data handling
- Never log or return plaintext provider keys, prompts, manuscript text or private context packs through ordinary logs.
- Enforce tenant isolation for every story-domain query and mutation.
- Provider endpoints must pass allowlist and SSRF validation, including redirect handling.
- Deletion and retention must cover derived data, indexes, exports and backup lifecycle as specified.