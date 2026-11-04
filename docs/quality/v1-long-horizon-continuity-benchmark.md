# V1 3000–4000 章跨卷叙事连续性基准

> Owner: M3 #103 (quality/release package) / #138 (implementation)
> Status: specification baseline; benchmark corpus and runs are not yet implemented.
> This benchmark verifies long-horizon story correctness. It does not certify storage capacity or infrastructure performance.

## 1. Objective and claim boundary

The target is a work spanning **30–40 volumes and 3,000–4,000 chapters**. A system that can store or retrieve ten million characters is not thereby proven capable of keeping a story coherent over thousands of chapters. This benchmark treats narrative continuity as a separate release gate.

The benchmark validates both:
- **Deterministic invariants:** canon state, version boundaries, character knowledge, timeline ordering, ownership/resource rules, branch isolation and approval gates.
- **Narrative quality signals:** motivation, character arcs, foreshadow setup/payoff, voice consistency, plotline progression and volume-level cause/effect.

The system's authoritative story facts and event history are the ground truth. Summaries, retrieval indexes and model-generated recollections are derived artifacts and must be demonstrably rebuildable.

## 2. Canonical long-horizon fixture

Create a versioned, deterministic story-world fixture with a canonical target of 3,500 chapters across 35 volumes (100 chapters/volume). Also support boundary variants of 3,000/4,000 chapters and 30/40 volumes. These are fixture shapes drawn from the product scale target, not a claim that generated prose alone is sufficient.

Each fixture release contains:

- Story Bible, genre pack version, world rules and locked constraints.
- Full five-level outline and volume contracts.
- Characters, aliases, relationships and validity intervals.
- Factions, organizations, goals, resources and territory/control history.
- Maps at multiple scales, locations, edges, routes and travel durations.
- Power/cultivation systems, level transitions, breakthrough costs, restrictions and lifespan policies.
- Special mechanisms for protagonist, supporting characters and antagonists, including rules, costs, limitations and growth.
- Typed items/resources/equipment/assets and separate ownership, custody, location, use and disposal rights.
- Objective canon events and time-bounded facts, with source chapters and version nodes.
- Character knowledge, beliefs, suspicions, misbeliefs and unknown facts at each relevant point in story time.
- Main/sub plots, character arcs, foreshadow setup/payoff/abandonment and volume-level turning points.
- Branch points, common ancestors and divergent futures.
- Approved style/voice samples with provenance; unreviewed drafts do not become authoritative style baselines.

The fixture generator must pin its seed, source hash, event manifest, schema version and generator version. It should generate enough prose-shaped material to exercise chunking, retrieval and context compilation, but every assertion must be tied to explicit ground-truth events rather than arbitrary text similarity.

## 3. Ground-truth state model

At minimum, every relevant state assertion carries:
- work, branch and version-node identifiers;
- subject/object identifiers and typed relation;
- valid-from/valid-to story time or chapter range;
- source event/chapter and source sentence or structured evidence;
- objective-canon status;
- character-knowledge scope and permitted disclosure time;
- decision/approval state where the fact is proposed, confirmed, locked or superseded.

Objective canon is not interchangeable with a character's belief. The test harness must be able to assert that a character can be wrong, suspicious or ignorant while the underlying world fact remains unchanged.

## 4. Required scenario families

### 4.1 Knowledge disclosure and POV boundary

- A secret exists in objective canon but only a subset of characters know it.
- A character may infer, suspect or falsely believe something without it becoming confirmed knowledge.
- Information becomes knowable only after an observable disclosure event, investigation or witness report.
- A future event, hidden author truth or another branch's fact must not leak into the current POV context.
- Aliases, titles, disguises and mistaken identity must not cause false knowledge transfer.

Pass condition: zero P0 knowledge-boundary violations in deterministic fixtures and in the approved evaluation sample. Every finding links to the source event, character and chapter where leakage occurred.

### 4.2 Body, injury, ability and lifespan continuity

Test injuries, permanent/severed limbs, healing, prostheses, death, resurrection and changes in body state. The story must not silently restore a lost limb, remove an injury or grant an ability without a source event and an authorized transition.

Cover age, lifespan and realm/level relationships, including worlds where lifespan binds to cultivation rank and worlds where it does not. Rule behavior is configurable by genre/world contract, not hard-coded globally.

### 4.3 Death, soul, reincarnation and identity transitions

Explicitly model and test:
- death and corpse/body status;
- soul destruction, persistence, splitting and transfer;
- resurrection and its cost/conditions;
- possession and control changes;
- reincarnation/rebirth and memory retention;
- clones, avatars, puppet bodies and parallel instances;
- identity continuity versus a new person/entity;
- revival limits, cooldowns, resources and permanent consequences.

The benchmark must distinguish “same identity in a new body”, “new identity with inherited memories”, “temporary control by another soul” and “independent clone”. No transition is inferred solely from prose wording; it requires a domain event or a reviewed fact proposal committed through the normal gate.

### 4.4 Equipment, resources and economic rights

Track unique items, stackable resources, equipment, assets, custody and location. Assert that transfer, theft, loan, inheritance, consumption, destruction, crafting and recovery update the correct rights independently. A character cannot use an item merely because they once owned it.

### 4.5 Time, maps, travel and relationships

Test event ordering, overlapping validity intervals, travel duration, simultaneous events, delayed messages, time skips, historical eras, map hierarchy and route constraints. Relationship changes must preserve start/end conditions and branch/version provenance.

### 4.6 Plotlines, foreshadowing, motivation and character arcs

Include planted clues, delayed payoff, false leads, abandoned foreshadows with explicit reasons, multi-volume conflicts and subplot dependencies. Test that:
- setups have a valid source and intended payoff window;
- payoffs reference the setup or record an approved alternative;
- a character's actions remain consistent with their knowledge, goals, fears and prior decisions;
- antagonists and supporting characters retain coherent incentives and competence;
- major reversals are causally supported rather than appearing from nowhere.

### 4.7 Branch divergence and canon revision

Create parallel branches at early/middle/late nodes. Verify unchanged shared history remains shared, while future state, knowledge, events, summaries and search results remain branch-specific. Selective merges must expose object-level conflicts and cannot silently import future knowledge into another branch.

### 4.8 Style and voice evolution

Use approved character/author voice samples across early/middle/late volumes. Differentiate intentional character growth, emotional change and point-of-view variation from accidental voice drift. Style checks report evidence; they do not silently rewrite or override canon.

## 5. Agent behavior benchmark

For each seeded continuity defect, test the full bounded agent loop:

1. Detect the inconsistency using structured facts, retrieval and summaries.
2. Cite source events, chapters, version nodes and affected characters.
3. Classify severity and explain whether it is a safe local issue, repairable conflict or structural conflict.
4. Propose a repair plan with predicted affected chapters/objects and uncertainty.
5. Check its task envelope, Grant, tool allowlist, budget and maximum impact before any side effect.
6. Execute only pre-authorized low-risk repairs that cannot change locked/high-risk canon; otherwise request author approval.
7. Re-run the affected continuity checks after an approved action.
8. Record every proposal, action, denial, escalation and result in the searchable AI Change Ledger.
9. Never grant itself additional permissions, directly submit canon, or represent an unexecuted proposal as an applied change.

Scenarios must include a false alarm and a deliberately incomplete context pack so the evaluator can distinguish correct abstention/escalation from overconfident mutation.

## 6. Evaluation architecture and metrics

Keep three layers separate:

| Layer | What it proves | Evidence |
| --- | --- | --- |
| Deterministic invariants | Typed state transitions, permissions, versions, knowledge filtering and branch isolation | Unit/property/integration tests with exact ground truth |
| Retrieval/context quality | Whether relevant facts are retrieved and forbidden facts excluded | Recall/precision, source coverage, freshness and leakage tests |
| Narrative quality | Whether cause/effect, motivation, arcs, foreshadowing and voice remain credible | Human blind review plus structured evaluator evidence |

For each automated assertion, record true positives, false positives, false negatives and true negatives where the oracle supports them. Report precision/recall by scenario family, severity, volume position and branch. A single aggregate score must not hide a P0 failure.

Initial hard gates follow the accepted evaluation baseline in ADR 0022:
- P0 fact loss: 0.
- Character knowledge-boundary violations: 0.
- Outline adherence: at least 90% on the approved rubric.
- Hook/prose score: at least 4/5 on the approved rubric.
- Continuity conflicts: no more than 1 per 50,000 characters on the approved rubric.

Any threshold change requires an explicit decision/ADR and a versioned benchmark release. Reader retention/real-reader response is not a substitute for these checks and remains disabled until real reader data and consented collection are available.

## 7. Human blind-review protocol

- Sample early, middle and late volumes; include branch divergence, major deaths/revivals, hidden-knowledge reveals, and long-delayed foreshadow payoffs.
- Reviewers must not see model identity or whether a passage was generated before scoring.
- Provide reviewers with the approved relevant canon/POV packet, not the full hidden author truth where the POV character should not know it.
- Record rubric version, reviewer ID, confidence, disagreement and adjudication.
- LLM self-scoring can triage and explain candidate defects, but can never be sole release evidence.
- The required number of blind samples and inter-rater agreement threshold are decision-required until signed off; do not invent a pass threshold.

## 8. Regression protocol and release gate

Any change to model, prompt, Agent Contract, grant/tool policy, context compilation, retrieval ranking, summary generation, genre pack or continuity rules must rerun the same pinned fixture suite. Record the code commit, schema/migration version, model/provider, prompt version, context compiler, evaluator/rubric version and fixture hash.

A release is blocked by:
- any P0 canon loss or knowledge leakage;
- any unauthorized or unreviewed high-risk canon mutation;
- branch contamination or future-fact leakage;
- untraceable state changes or unrecoverable derived memory;
- rubric threshold failure without an approved waiver;
- missing human review evidence for subjective long-horizon quality claims.

Every failure must identify work/branch, chapter range, source event, affected entity, version node, responsible runtime step and minimal reproduction. Waivers include owner, rationale, impact, expiry and follow-up issue.

## 9. Out of scope

This benchmark does not certify 10M data storage, database/index latency, 100GB disk fit, import/export throughput, backup/restore time or provider rate limits. Those belong to docs/performance/v1-10m-capacity-benchmark.md and #137.
