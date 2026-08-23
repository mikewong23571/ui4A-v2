# T20 Architecture — Contract-Driven Meta Human Control Plane

## 1. Boundary

```text
Meta sitemap + Siren entities/actions/links
                  │
                  ▼
       Meta Browser Client (scope + auth)
                  │
                  ▼
    Surface descriptors + URL route resolver
                  │
                  ▼
       Renderer registry by Siren class
          │                       │
          ├─ generic fallback     ├─ Application
          ├─ collection/detail    ├─ Agent Definition
          │                       └─ Draft/Activation
          ▼
    shadcn/RJSF/graph/diff deterministic UI
                  │
                  ▼
         /_meta/api/exec → current judgment
```

Meta API and append-only events remain authoritative. Browser components never reconstruct permissions, activation validity or business state. This Track is a human projection of existing contracts, not a new Definition Plane.

## 2. Discovery Model

`MetaSurfaceDescriptor` is a pure projection of the authorized Meta sitemap:

- `rel`, `title`, collection/exact kind;
- derived browser href;
- current scope reference;
- optional summary category and renderer hint derived only from Siren class after entity read.

The dashboard renders top-level collection/self descriptors. Exact entities remain discoverable through collection members and links. A synthetic future surface therefore appears without editing a `FACES` array.

## 3. Scope and Identity

Phase A must spike the current local-demo and future credential behavior before implementation. The intended rule is:

```text
requested UI scope ∩ credential authorized scopes = effective scope
```

The browser may store the selected authorized scope in the URL, but the server derives principal/authorization and rejects overrides. `MetaClient` consistently sends/receives effective-scope provenance for sitemap, list, exact and exec. In the self-reported local demo, the weaker identity model remains visibly labeled and is not documented as production auth.

## 4. Routes and URL State

- `/meta`: dynamic control-plane dashboard.
- `/meta/entity?rel=<encoded>&scope=<authorized>`: stable generic deep link.
- Existing friendly routes (`/meta/flows`, `/meta/flow/[name]`, etc.) may remain compatibility aliases.
- `tab`, `filter`, `query` and `scope` are URL state; server truth and action state are never stored only in React memory.

Navigation consumes Siren links. Breadcrumbs are derived from collection/source/target relations with a bounded fallback, not from product-specific entity names.

## 5. Renderer Registry

The registry resolves a renderer from Siren `class` tokens and optional structural predicates:

1. exact high-priority specialized renderer;
2. generic collection renderer;
3. generic detail renderer;
4. unsupported/error surface.

Ambiguous equal-priority matches fail closed in development/tests. Registration modules own their view model and presentation; the router/dashboard never imports Application names or Draft statuses. Functional controls are rendered only from `entity.actions`.

## 6. Specialized Information Architecture

### Application

Header (title/intent/version) → relationship summary → Overview/Flows/Capabilities/Policies/Versions tabs → provenance/raw disclosure. Embedded bundle data is mechanically grouped; it is not copied into a second application model.

### Agent Definition

Header (intent/active version/runtime class/Eval) → Prompt → Task/Result → Runtime → Tools/Resources/Artifacts → Evaluation → Versions/Runs. Authority/binding/deployment are visually distinct. Secrets and private Runtime Profile fields are never part of the Siren payload.

### Draft and Activation

Header (status/target/owner/scope/version) → blocking issues → authored/effective diff → checks/Eval/sources → history/raw → sticky human decision region. Actions remain current Siren actions rendered through RJSF. Approval content is deterministic and does not use Presentation Sidecars.

## 7. Data Fetching and Performance

- Dashboard: one sitemap request plus bounded collection summaries; no exact-member N+1.
- Collection: use embedded member summaries.
- Detail: one exact request; tab viewers share one revision-aware entity cache entry.
- Action: re-read exact entity immediately before exec, submit declared action/schema, then invalidate/refetch affected rels.
- Search: bounded client index from authorized summaries; it never fetches hidden exact entities.

Loading/error boundaries operate per section where possible. Large diff/table/schema content scrolls inside its region so the page shell remains stable.

## 8. Safety and Replay

- UI never accepts actor/principal/approval scope from form data.
- `internal: capability-callback` actions are filtered before Renderer registration.
- Cross-scope 404 remains indistinguishable from absence.
- Provider endpoint/key/env values are absent from Meta business views.
- Replay acceptance rebuilds Application, Draft, Agent Definition and Agent Run projections, then compares rendered view-model facts/links against pre-rebuild values.

## 9. Expected File Boundaries

- `apps/web/src/app/meta/`: dynamic shell and generic route/compatibility pages.
- `apps/web/src/components/meta/shell/`: dashboard, scope, search, breadcrumbs, state boundaries.
- `apps/web/src/components/meta/renderers/`: registry, generic fallback and specialized renderers.
- `apps/web/src/components/meta/view-models/`: pure mechanical projections with colocated tests.
- `apps/web/src/components/meta/meta-client.ts`: authorized scope transport, cache and current-action execution.
- `e2e/`: human Golden Stories, action fuzz, accessibility/mobile and replay.

No new package, database table, event family, global state library or UI framework is expected. Any deviation must update `conductor/tech-stack.md` and `DECISIONS.md` before implementation.
