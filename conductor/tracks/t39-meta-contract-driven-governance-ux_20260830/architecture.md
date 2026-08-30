# T39 Architecture — Cognitive Contract, Meta Canonical Route and Application Library

## 1. Scope

T39 delivers one shared cognitive-contract foundation and two independent milestones:

```text
Phase B shared foundation
├── Phase C–F Meta governance milestone
└── Phase G Application library milestone

Phase H proves Assistant shared gaze and complete user stories.
```

Meta and Application milestones share field presentation, cognitive semantics and public-contract
parity, but each remains runnable and revertible without the other.

## 2. Non-negotiable product boundaries

- Application is a library and launch point; `/` plus Work Thread remains the desk.
- Meta is a deliberate tool room; workstation never reads `meta/application:*` implicitly.
- Raw is a local audit lens, not a site.
- Complex Draft authoring remains external Agent/CLI/Assistant work; Meta human UI reviews facts and
  owns decisions.
- Business/Meta definitions contain facts and stable cognition, never device layout or component
  policy.
- Public HTTP/CLI remains complete. Assistant builds a smaller prompt projection from the same facts.

## 3. Cognitive semantics

### 3.1 Derive first

Semantic meaning is mechanically derived from existing facts whenever possible:

- actions and SubmissionPolicy;
- Flow/Application ownership and topology;
- field `presentation.role/overview`;
- collection declarations and append effects;
- entity status and canonical links.

Only meaning that cannot be derived is declared through a small closed vocabulary.

### 3.2 Minimal wire

The shared semantic projection is versioned and bounded:

```text
CognitiveSemanticsV1
├── traits[]
├── groupRole?
├── priority?
├── emptyMeaning?
└── fields[]          // existing SirenFieldPresentation
```

No field may describe table/card, sticky, heading source, responsive breakpoints, CSS, components or
free layout.

### 3.3 One projector, two public projections

One pure projector emits the same cognitive source into:

- `SitemapSurface.presentation` for discovery/grouping;
- exact `SirenEntity.properties.presentation` for binding and rendering.

The sitemap copy participates in the sitemap content hash. The exact copy participates in the
entity-contract fingerprint. They are not assembled independently.

HTTP/CLI may read the full cognitive projection. Assistant uses an explicit allowlist and never
receives visual policy.

## 4. Visual policy

Visual posture remains outside business and Meta definitions:

- Meta uses a deterministic generic Renderer policy over traits, viewport and contract shape.
- Workstation uses Recipe/Sidecar/generic Presentation policy and word catalog.
- table/card/decision-list, density, sticky/inline, heading source, collapse and responsive fallback
  remain implementation policy.

Existing composition `density` is contained and migrated toward the generic policy; it is not a new
Application contract pattern.

## 5. Action input ownership

Public action schemas use one optional JSON Schema annotation:

```json
{ "x-ui4a-input-owner": "client" }
```

- absent or `caller`: caller supplies the value; human UI and Agent tools expose it;
- `client`: trusted host derives/generates it; human UI and LLM tools remove it, then the host injects
  it before full-schema validation;
- server-owned values are absent from public params and come only from trusted execution context.

Submission order:

```text
caller-schema validation
→ trusted client injection
→ full action-schema validation
→ trusted identity/context
→ declaration → guard → schema → execution
```

The same logical submission reuses `commandId`; changed caller parameters form a new submission.
`baseVersion` is the version observed when the user starts the interaction.

Draft create removes request `policyScope`; execution consumes trusted context. `schemaRef` is removed
when kind uniquely determines it. RJSF, Agent tools, CLI, Siren and server judgment migrate atomically.

## 6. Assistant disclosure and runtime budget

Public entities remain complete. Provider requests do not contain full Siren snapshots.

Each decision is rebuilt from authoritative sources:

```text
immutable full sitemap
→ scoped cognitive sitemap slice
→ one current sanitized entity observation
→ current actions/tools
→ bounded structural trail (rel/action/result refs)
→ provider request
```

The observation projector retains canonical identity/status, role-budgeted current facts, current
actions and guard reasons, links, bounded collection member summaries and task-relevant traits. It
removes raw bundle/payload/definition text, visual policy, Recipe/Sidecar/Surface and old full entity
observations.

The final provider request is measured as UTF-8 JSON before fetch:

```text
byteLength(providerRequest) <= 32,768
```

Over-budget fails structurally before network, exec or mutation. Component byte counts are diagnostic
only. Tests use real-shape articles/comments/Meta entities, UTF-8, trail, conversation and prior
observations.

## 7. Meta canonical route

Before route cutover, all implicit `publishing`/first-grant lens defaults are removed. Missing lens is
a first-class state and never affects authorization.

The single human route is `/meta/entity?rel=...`:

- registry adds Flow, Activation and Capability specializations;
- canonical shell owns loading, errors, sitemap revision, exact cache, relationships, raw and refresh;
- all internal links and cross-site bridges use canonical query URLs;
- seven friendly routes, fetch wrappers and hardcoded lists are deleted in one cutover;
- no redirect, rewrite, compatibility flag or dual-state test remains.

Successful Meta writes invalidate authorized Meta exact/collection/dashboard caches needed by the
new projection, not only the executed rel.

## 8. Application library projection

### 8.1 Authorized binding source

```text
active ApplicationDefinition
→ SitemapApplication
→ application:<name> read-only business Siren entity
→ workspace:app:<name> bindings
```

`application:<name>` contains title, intent, minimal traits and derived entry descriptor. It has no
action, event or storage. Authorization is application name × grantedApplications.

### 8.2 Minimal definitions

```text
Application trait: system-fallback

Entry role:
  primary-create | primary-task | primary-collection | resume

Surface role:
  work-queue | review-queue | output-catalog |
  task-history | human-responsibility | audit-only
```

Entry contains target + role only. Titles/descriptions come from target facts. Empty UI posture is a
Presentation policy over semantic `emptyMeaning`.

### 8.3 Invariants

- system fallback is absent from the shelf and has no normal landing/cross-app entry;
- ordinary Application entry targets its own business surface;
- `meta/`, `_meta` and `workspace:` cannot be implicit entries;
- collection owner derives from Flow `collections`, then append effects; ambiguity rejects;
- extra surfaces do not invent business ownership;
- authorize and resolve sources before canonical `properties.rel` deduplication;
- higher responsibility occurrence wins, while full collection membership remains in dependency
  fingerprints;
- composition version/fingerprint changes with declaration content;
- role maps to existing exact Presentation intents through one generic policy, not per-app strings.

Application shelf uses discoverability, declaration order and current lens emphasis. Pin/recent is
deferred; existing Sidecar pin is not repurposed.

## 9. Governance and growth

Standing checks should reject:

- visual policy in business/Meta definitions;
- runtime Application/rel/action-name branches;
- server-owned public action params;
- Meta friendly-route remnants after cutover;
- Assistant visual metadata or request budget overflow;
- ambiguous collection ownership and invalid entry plane/ownership;
- a ninth fixture requiring runtime code changes.

No new package, database, event family, UI framework or page DSL is introduced.

## 10. Delivery and rollback

- Phase B is the shared foundation.
- Phase C–F ends in an independently runnable Meta milestone.
- Phase G is an independently runnable Application milestone.
- Phase H only integrates and validates.
- Canonical route cutover is one revertible commit.
- Public action ownership migration is one atomic wire change.
- Application data is updated only after pure invariants and generic composition tests are green.

