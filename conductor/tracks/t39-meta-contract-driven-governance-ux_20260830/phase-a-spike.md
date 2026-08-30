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
