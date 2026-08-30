# T39 Phase A Spike Evidence

> Phase A evidence log maintained by the orchestrator. Subagents return bounded findings; only the
> orchestrator writes Track documents and makes architecture decisions.

## A1 Current propagation inventory

### Proven chain

```text
Application/Flow definitions
  → append-only definition events → EngineSnapshot
  ├─→ business/meta sitemap → HTTP/CLI/Agent discovery
  ├─→ Siren entity → Recipe/Sidecar/Surface → Canvas
  └─→ Siren entity → Meta direct Renderer/RJSF
                         └─ canonical and friendly routes currently diverge
```

Key ownership and version facts:

- `FieldDefinition.presentation` currently owns semantic field `role` and `overview`; Flow
  `collections` owns filter declarations; `ApplicationDefinition` only owns
  `name/title/intent/entry/submission`.
- Business sitemap is content-hashed from active flows, applications, capabilities and collection
  keys. Meta sitemap ownership is split between `service-sitemaps.ts` and the HTTP route that adds
  Draft/Agent Definition surfaces.
- Siren projects field roles/overview and collection filters into `properties.presentation`.
- Application landing derives `workspace:app:<scope>` from sitemap sources; Recipe/Sidecar/Surface
  stays binding-only and hydration rereads current Siren facts.
- Meta is intentionally outside Recipe/Sidecar, but canonical `/meta/entity` registers only
  Application, Agent Definition and Draft specializations; Flow, Activation and Capability still
  reach richer legacy route implementations.
- Assistant sitemap disclosure is scoped, while observations currently serialize complete Siren
  entities; new visual metadata would therefore reach prompts unless explicitly excluded.

### Risks to probe in A2–A7

1. `deriveAppWorkspaceComposition()` changes regions with sitemap content but fixes declaration
   `version: '1'`, conflicting with versioned composition semantics.
2. Application workspace intent strings do not match Scenario Enumerator intents, so dynamic
   landings normally miss generated Recipes and fall to generic planning.
3. `ApplicationEntryStrip` contains `application.name !== 'default'`, a direct per-app branch.
4. Application entry parsing does not enforce same-app ownership, business plane or semantic role.
5. Meta base sitemap surfaces need a dedicated granted-union disclosure audit.
6. Full Siren observations and count-only observation bounds do not provide a general runtime byte
   guard for large Meta Flow/Application entities.
7. Meta client invalidates only the executed rel; related collection/dashboard caches may stay
   stale without a sitemap revision change.
8. RJSF has no input-ownership model, and Draft exact rendering also owns a local kind-specific
   editor schema.
9. Scope defaults remain in canonical Meta, old views and Situation assembly despite D51's
   unlocated-first requirement.

### Orchestrator light verification

Verified directly:

- fixed composition version: `apps/web/src/engine/presentation/app-workspace-composition.ts`;
- `default` name branch: `apps/web/src/components/application-entry-strip.tsx`;
- missing known Meta registrations: `apps/web/src/components/meta/renderers/meta-entity-renderer.tsx`;
- full observation serialization: `packages/agent/src/llm/prompts.ts`.

No production source changed. A1 required no behavioral test.

## A2 Trait/Semantic Hint placement probe

### Result

The four candidate locations are not alternatives; data must be split by meaning:

| Data | Authority | Public projection | Invalidation |
| --- | --- | --- | --- |
| Business/definition facts | Existing Application/Flow definitions and events | Exact Siren; bounded discovery summary where needed | Definition/sitemap version |
| Stable cognitive semantics | Prefer pure derivation from topology, actions, SubmissionPolicy and field presentation; only irreducible semantics get a separate versioned definition | Sitemap discovery semantics plus exact `properties.presentation` | Sitemap content hash plus entity-contract fingerprint |
| Visual policy | Presentation policy, Recipe, Sidecar and catalog | Not required in business HTTP/CLI/Assistant disclosure | Declaration/catalog/Recipe dependency |

The probe rejected a generic `ApplicationDefinition.presentation = {traits,hints,...}` blob. Current
Application parsing drops unknown keys, typed Agent sitemap parsing rebuilds a narrow shape, exact
Siren preserves `properties.presentation`, and only that presentation subtree currently participates
in the entity-contract fingerprint. Composition changes correctly invalidate Sidecars, but Composition
cannot become the sole source of stable human/Agent semantics.

### Binding and disclosure consequences

- Sitemap can support discovery/grouping but is not a bindable fact source.
- Application title/intent needs an authorized Siren binding path before a binding-only Surface can
  display it; copying sitemap values into Surface literals or silently reading `meta/application:*`
  is rejected.
- HTTP/CLI may expose bounded cognitive semantics, while Assistant prompt disclosure needs an
  explicit allowlist. Visual density/sticky/responsive policy must never be spread into observations.
- Existing composition `density` is a visual-policy precedent to contain, not a business-definition
  contract to extend.

### Disposable probe observations

- Unknown ApplicationDefinition annotations are dropped and do not change sitemap version.
- Adding metadata to the final sitemap shape changes its content hash, but the typed Agent parser
  drops unknown fields until explicitly extended.
- Exact entity `properties.presentation` survives parsing and changes the Sidecar entity-contract
  fingerprint; top-level or unrelated `properties.traits` do not.
- Composition density changes its fingerprint and causes the affected root to replan.
- Recipe candidate metadata alone does not change its deterministic key; key intent does.

### Orchestrator light verification

Re-ran the focused suite reported by the subagent:

```text
6 test files / 60 tests passed
prompt budget sample wire sizes: 14,642–14,718 bytes (<32 KiB)
```

No production source or temporary artifact remained.

## A3 Overview reuse and visual-policy boundary

### Result

`SirenFieldPresentation {path,title,role,overview}` remains the single field-cognition wire shape.
It already preserves declaration order, honest missing values, identity/status deduplication and
HTTP/Agent parity for Flow instances. T39 must extend its consumption and projection coverage rather
than create `summaryFields`, `desktopOverview` or a parallel Meta schema.

Current gaps:

- read-only collection members choose `member-link` and do not consume overview bindings;
- `member-card` does not consume overview, so a narrow-screen vocabulary change would lose fields;
- Application/Meta summaries expose derived properties but not a unified
  `properties.presentation.fields` description;
- action presence currently chooses decision-card posture, which cannot distinguish an ordinary
  actionable member from a human responsibility point;
- the fixed table word has no 390px vocabulary fallback.

### Minimal direction

1. Flow projections continue deriving field presentations from `FieldDefinition`.
2. Meta/Application/Draft/Activation projections describe their deterministic derived properties
   through the same Siren field-presentation shape; paths must resolve to projected facts.
3. `member-link`, `member-card` and `member-table` may all consume the same optional overview
   semantics, so Presentation policy can change vocabulary without changing cognition.
4. Entity-level responsibility semantics remain separate from field roles.
5. Desktop table vs narrow card/decision-list, sticky and heading posture stay in Presentation
   policy; none enter business or Meta definitions.

### Rejected

- parallel summary/overview schemas;
- device-specific overview fields or definition-side density/sticky/heading hints;
- Application/rel/class/action-name mappings for component choice;
- inferring human responsibility from `approve`/`reject` names or any action presence.

### Orchestrator light verification

Re-ran the exact focused suites:

```text
unit: 8 files / 123 tests passed
db route: 1 file / 21 tests passed
```

The DB output contained only existing textarea-format warnings. No A3 repository change remained.

## A4 Action input ownership and Draft boundary

### Result

Use one language-neutral JSON Schema property annotation:

```json
{ "x-ui4a-input-owner": "client" }
```

Wire semantics:

- missing or `caller`: caller supplies it; human RJSF and Agent tool keep the field;
- `client`: a trusted host generates or derives it; RJSF/LLM omit it, then the host injects it before
  full-schema validation;
- server-owned values never appear in public `action.fields` or params and come only from trusted
  request/execution context.

This maps the specification language to `human-authored → caller`, `client-generated → client`, and
`server-owned → outside public params`. `caller` is preferred to `human` because external Agent/CLI
uses the same wire.

### Required single-wire corrections

- remove `policyScope` from Draft create params and consume trusted `context.policyScope` directly;
- remove request-controlled `schemaRef` when Draft kind uniquely determines it;
- annotate command IDs and observed base versions as client-owned;
- derive caller schemas for RJSF and Agent tools by removing client fields and matching `required`
  entries, inject host values after UI/LLM output, then validate the full action schema;
- reuse one command ID across transport retries of the same logical submission; parameter changes
  create a new logical submission;
- preserve observed `baseVersion` rather than fetching the newest value at submit time.

The project is unreleased, so the change must be atomic across Siren, RJSF, Agent tool projection,
CLI and server judgment. Field-name fallbacks, hidden widgets, dual schemas, or compatibility branches
are rejected.

### Product boundary

The ownership model removes infrastructure fields from human controls but does not justify a complete
Draft editor. Agent/CLI/Assistant remains the main complex-ingress path; Meta UI begins with existing
Draft review and responsibility actions.

### Orchestrator light verification

Re-ran the reported suites:

```text
unit: 5 files / 83 tests passed
db: 3 files / 14 tests passed
```

No A4 repository or temporary change remained.

## A5 Canonical Meta route cutover

### Result

`/meta/entity?rel=...` already owns sitemap-first loading, revision-aware exact cache, scope-aware
link adapters, fresh-read actions and safe registry fallback. Flow, Activation and Capability remain
unregistered, while seven friendly routes own richer topology/version/checks/diff views with separate
fetch shells and incomplete scope propagation. The migration is therefore a single human-route
cutover, not an API or engine-projection redesign.

Canonical registry additions:

- `flow-definition` → reuse the pure Flow content view for `meta/self` and `meta/flow:*`;
- `activation` → reuse checks/diff content and canonical scoped `MetaActions`;
- `capability-definition` → reuse intent/input/output content.

Canonical shell remains the only owner of sitemap/exact loading, missing/error, revision cache,
relationships, raw contract and refresh. Collection routes first use generic canonical collection;
Phase D later improves them through overview semantics instead of retaining hardcoded list views.

### Atomic cutover

1. Red canonical specialization/page tests.
2. Remove the canonical and Flow-view `publishing` defaults before route convergence.
3. Connect the three specializations while preserving canonical links/raw/actions.
4. In one cutover commit, switch all links/presence bridges, delete seven old routes, delete three
   fetch-body wrappers and `meta-lists`, and migrate unit/E2E expectations.
5. Scan for old browser paths; keep canonical `meta/flow:*` rels.
6. Add no redirect, rewrite, flag, compatibility test or dual router. Rollback is an entire cutover
   revert.

Phase A9 must also revise D32's “friendly route compatibility” wording and D46's explicit
`/meta/flow/<name>` bridge decision before production changes.

### Orchestrator light verification

Re-ran the exact focused suites:

```text
Meta/presence unit: 12 files / 66 tests passed
Meta route/service/engine: 4 files / 43 tests passed
```

No A5 source or temporary change remained.

## A6 Application fact binding and workspace semantics

### Result

Application landing facts use a business-plane read-only Siren projection:

```text
active ApplicationDefinition
  → authorized SitemapApplication discovery
  → application:<name> read-only Siren entity
  → workspace:app:<name> header region
  → property bindings and fresh hydration
```

`application:<name>` derives `title`, `intent`, stable traits and an entry descriptor from active
definition/sitemap truth, has no actions/events/storage, and is authorized by application name ×
grantedApplications. Copying values into Surface literals, binding directly to sitemap, attaching
facts to the virtual workspace, or reading `meta/application:*` from workstation are rejected.

### Minimal stable semantics

- Application trait: only `system-fallback` is currently necessary.
- Entry roles: `primary-create | primary-task | primary-collection | resume`.
- Surface traits: `work-queue | review-queue | output-catalog | task-history |
  human-responsibility | audit-only`.
- Visual density/sticky/device/layout remains Presentation policy.

Pure invariants:

1. system fallback is absent from the shelf and has no workspace landing/cross-app entry;
2. ordinary discoverable applications have a same-application business entry; `meta/`, `_meta` and
   `workspace:` are forbidden implicit entries;
3. collection ownership comes from Flow `collections`, then append effects; ambiguity rejects rather
   than defaulting;
4. extra surfaces cannot invent business collection ownership;
5. alias/entity sources are authorized then deduplicated by canonical `properties.rel`; the
   higher-responsibility occurrence wins and lower collection duplicates are view-filtered only;
6. authoritative collection membership remains in dependency fingerprints, so view deduplication
   never hides invalidation.

The same rules express current applications: default becomes system fallback; publishing is
primary-create + output-catalog; community derives comments ownership and review responsibility;
development/editorial use primary-task + history with canonical deduplication; governance returns to
its business authoring flow and uses an explicit Meta bridge; todo/ideas use creator surface titles.
A ninth fixture needs only definition data.

### Preference boundary

Discoverability is definition truth and current lens is Presence attention. Existing Sidecar pin is
not an Application-shelf pin. Adding pin/recent would need a separate bounded user preference/history
projection and is not required for the current stories; the minimal plan should retain declaration
order plus current lens and avoid this expansion.

### Orchestrator light verification

Re-ran the focused baseline:

```text
6 files / 51 tests passed
```

No A6 repository or temporary change remained; live CLI was unavailable and no result was invented.

## A7 Assistant disclosure and byte budget baseline

### Measured baseline

Current local data contains 27 articles, 4 comments and 10 Flows.

| Scenario | HTTP sitemap | Typed sitemap | Prompt slice | Entity | Messages | Tools | Full wire |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| publishing `flow:article-drafting` | 52,207 | 17,892 | 2,518 | 1,059 | 7,970 | 7,749 | 19,787 |
| community `comments` | 52,207 | 17,892 | 1,399 | 4,577 | 15,462 | 6,414 | 25,881 |
| governance `meta/flows` | 2,507 | 2,223 | 2,212 | 50,121 | 163,954 | 6,987 | 174,947 |

Real `articles` produces an approximately 115 KiB provider wire; the largest Meta Flow and
Application examples also exceed the current 32 KiB target. Existing budget tests use small
fixtures and do not cover full collections, Meta bundles, multiple observations, trail or
conversation.

### Non-accumulation finding

The loop correctly keeps one immutable full sitemap and rebuilds a scoped slice plus current tools
on every step. It does not provide the same guarantee for observations: up to eight complete Siren
snapshots and trail entries accumulate. Navigating `article-drafting → articles` grew messages from
about 8 KiB to 107 KiB because the earlier entity remained alongside the large collection.

Phase A8/A9 must explicitly decide the observation contract; entity-count bounds cannot substitute
for a UTF-8 byte budget.

### Required boundary

- public HTTP/CLI remains complete and has no Assistant budget narrowing;
- Assistant sitemap uses an explicit cognitive allowlist and rejects visual policy fields;
- Assistant entity observations need a dedicated projection/sanitizer rather than full Siren JSON;
- final serialized provider request is the authoritative runtime budget, measured before fetch;
- an over-budget request fails structurally and honestly before network or mutation.

Initial budget candidate for the Phase A decision: total provider wire 32,768 bytes, with diagnostic
component targets for system/tools/messages/envelope and sitemap slice. A8 must confirm whether to
adopt the exact component numbers; tests must use real-shape articles/comments/meta entities,
multi-observation, UTF-8, trail and conversation.

### Orchestrator light verification

Re-ran the exact focused suite:

```text
6 files / 84 tests passed
existing synthetic wire samples: 14,642–14,718 bytes
```

No A7 repository or temporary change remained.

## A8 Adopted spike findings

### Track shape

Keep one T39 Track with a shared Phase B and two independent milestones:

- Meta milestone (C–F), complete and revertible without Application work;
- Application milestone (G), dependent on shared semantics but not on Meta UI implementation;
- H proves shared gaze and final E2E; it does not add a second disclosure implementation.

### Adopted architecture

1. Derive cognitive semantics whenever existing topology, actions, SubmissionPolicy, ownership or
   field presentation already provides the meaning. Only irreducible stable semantics are declared.
2. A minimal versioned cognitive semantics shape is projected by one pure projector into sitemap
   discovery and exact `properties.presentation`; visual policy stays outside definitions.
3. Input ownership uses a single `caller|client` JSON Schema annotation; server values leave public
   params. Draft create removes request `policyScope`, and schemaRef is server-derived where kind is
   authoritative.
4. Clear default lens behavior before atomically deleting friendly Meta routes; no redirect or dual
   wire. Meta mutations invalidate the relevant authorized Meta cache scope, not only one rel.
5. Add read-only business `application:<name>` Siren projection, minimal `system-fallback`, entry
   role and surface roles, pure collection ownership and canonical view deduplication.
6. Replace complete Siren observations with a task-scoped observation projector, one current
   observation plus bounded structural trail, and a final serialized UTF-8 provider request hard
   guard at 32,768 bytes before fetch.
7. Public HTTP/CLI remains complete; Assistant uses an explicit cognitive allowlist and never sees
   visual policy.

### Rejected or deferred

- generic `ApplicationDefinition.presentation` or visual-policy DSL;
- density/sticky/heading/device metadata in business or Meta definitions;
- complete Draft editor as the Meta human path;
- legacy route redirects or compatible dual action wire;
- pin/recent Application shelf preference in T39;
- per-app/per-rel runtime branches, new dependencies, database or event families.

The shelf uses discoverability, declaration order and current lens only. Existing Sidecar pin is not
reused for a different preference meaning.

### Mandatory A9 document updates

- extend D41/D51 so non-accumulation includes entity observations and the final provider request has
  a runtime byte guard;
- supersede D32 friendly route compatibility and D46's `/meta/flow/*` bridge;
- record the `caller|client` public action annotation and server-owned exclusion;
- record cognitive-semantics dual projection, Presentation policy boundary, read-only business
  Application projection, entry/ownership invariants and composition version/intent rules;
- rewrite Phase B–H ordering, remove shelf pin/recent, move scope cleanup before canonical cutover,
  and keep two independent milestones.

A8 introduced no code or new test claim; its inputs are the independently verified A1–A7 evidence.
