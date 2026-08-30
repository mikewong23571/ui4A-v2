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

