# Implementation frontier v2

> Updated: 2026-11-04.
> Repository baseline: main after PR #153 (A–D readiness remediation) was merged at `95b0d57`. Final Design Freeze is maintained as a separate implementation branch and reviewed through its own PR.

## 1. Current truth

- Production Web/API/Worker source has not been created yet; the signed-off prototype is a design baseline, not a production application.
- M0 specification: #66; M0 implementation tickets: #67–#79.
- M1 specification: #80; M1 package/integration tickets: #84–#90.
- M2 specification: #81; M2 package/integration tickets: #91–#97.
- M3 specification: #82; M3 package/integration tickets: #98–#104.
- New bounded leaf tickets: #106–#152. They are mapped; their existence does not make them startable.
- PR #105 established the first M1–M3 ticket layer; PR #153 subsequently added bounded leaf tasks, unique capability ownership, explicit UI evidence paths and independent scale/quality gates.

## 2. First executable frontier

Only #67 is the M0 starting point. After #67 is implemented, reviewed and integrated, follow the blocker graph and issue bodies. Do not infer readiness from milestone order or labels.

M0 first-order sequence:
- #67 skeleton/health/contracts/fake provider.
- #68 and #69 may proceed after #67 when shared auth/model contracts are frozen.
- #70 follows #67/#68; #71/#72/#73 depend on #70.
- #74 follows #73; #75 follows #73/#74.
- #76 follows #69/#74/#75; #77 follows #76; #78 follows #75/#77.
- #79 is M0 integration and UI/security/real-provider closeout after #68–#78.

## 3. M1 leaf sequencing

M1 foundations:
- #143 after M0 #70/#73; #144 after #74/#143.
- #106–#108 consume #144 and M0 #74; share IDs/version/tenant contracts before parallel DB work.
- #145 depends on #143/#144 and #106–#108; #146 depends on #143/#145/#106.
- #147 depends on #143/#145/#76; #148 consumes #143/#144/#145 and required domain/M0 contracts.
- Agent Runtime: #109 after #67/#69/#144; #110 after #109/#76; #111 after #143/#144/#106–#108/#76; #112 after #106–#108/#111; #113 after #145/#146/#111/#112; #114 after #109/#110/#69/#76; #115 after #110/#114.
- Writing: #116 consumes #109–#115 and #145/#146; #117 consumes domain/runtime/critic prerequisites; #118 follows #116/#117; #119 follows #106/#145/#146/#117.
- #90 integrates M1 package outputs and the signed xianxia sample; it is not a shortcut around unfinished child work.
- #141 follows #68/#69; #142 follows #70, with irreversible deletion behavior coordinated with #134.

## 4. M2 leaf sequencing

- #151 consumes #110; #152 consumes #151/#115. #91 is the package/integration parent.
- #92 adds history/urban Genre Packs after the #84/#85 contracts.
- #149/#150 consume #91 plus the Critic/readiness and runtime provenance/recovery contracts; #93 is their package parent.
- #120 → #121 → #122 is the change request/impact/apply path.
- #123 uses the M0 version graph and #144/#106–#108; #124 consumes branch and impact/diff contracts; #125 consumes selective decisions and high-risk policy.
- #126/#127 provide large import and optional setting extraction; #128 adds Chinese search/indexing after relevant data/retrieval/import contracts.
- #97 integrates notifications and page-level M2 acceptance.

## 5. M3 release and proof sequencing

- #129 export; #130 publish checks/preview; #131 legal/help/AI disclosure and appeal.
- #132 aggregates RLS/authorization coverage, but every feature ticket must add RLS when it creates a tenant-owned table.
- #133 follows provider/runtime trace contracts; #135 consumes hardened logs/metrics; #134 implements account export/deletion and coordinates with #136 backup retention.
- #136 backup/restore follows deletion-retention and operations contracts.
- #137 capacity benchmark runs against the integrated schema and storage/backup stack.
- #138 long-horizon continuity fixture depends on domain, planning, runtime and writing primitives; #139 pins it into the fixed quality suite; #140 gates real-provider canary/rollback.
- #104 is the V1-wide UI closeout and is last among page parity aggregators.

## 6. Package-parent rule

Do not pass these package parents to /implement as one task: #84–#89, #91, #93–#96, #98–#103. Implement their bounded child issues first and close the parent with integration evidence. #90, #97 and #104 are integration gates; they are not substitutes for feature work.

Full map and dependency graph:
- docs/planning/m1-m3-ticket-map.md
- docs/planning/v1-issue-dependency-graph.json
- docs/planning/v1-capability-traceability.md
- docs/ui/v1-ui-parity-matrix.md

Run the static checks from repository root:
```bash
node scripts/validate-readiness.mjs
```

Do not start a task if its dependency graph says a blocker is open, its capability primary owner is missing, or a required product/ADR decision remains unresolved.
