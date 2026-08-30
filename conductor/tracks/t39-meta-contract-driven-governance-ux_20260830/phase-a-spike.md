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
