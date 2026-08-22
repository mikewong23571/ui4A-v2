# T16 Technical Architecture — Presentation Plane

## Architectural Decision

Chat Agent 需要知道“可以请求呈现”，但不读取或生成完整 Present/A2UI 协议。完整渲染规划位于独立 Presentation Plane。Application 在定义激活后提前枚举典型场景并生成参数化 Render Recipe；运行时优先命中跨 Session 的 User Sidecar 或 Application Recipe。Session 只保存 active Sidecar 引用和未提交 UI 状态，不拥有独立渲染缓存。

## Plane Boundaries

```text
Application Definition / Catalog
          │ activation/change
          ▼
Scenario Enumerator ──► Presentation Agent ──► Recipe Validator
                                                 │
                                                 ▼
                                      Application Recipe Registry

User / Chat / Direct Navigation / Flow Transition
          │ thin PresentationRequest
          ▼
Presentation Broker
          │ authorize + build Situation
          ▼
User Sidecar Resolver
   ├─ user pinned/cache hit ─────────────────────────┐
   ├─ promoted/candidate Application Recipe hit ────┤
   ├─ generic fallback ──────────────────────────────┤
   └─ miss → Presentation Agent runtime planning ───┤
                                                    ▼
                                      A2UI Hydration + Action Gate
```

### Chat Plane

Owns user/assistant raw messages, goal, focus, referents, constraints and the decision to request presentation. It emits only a thin request and consumes a receipt. Chat prompt/history must not contain A2UI catalog payloads, Surface Trees, dependency DAGs or hydration data.

### Presentation Plane

Owns Situation/Lens construction, scenario enumeration, Presentation Agent context, Application Recipes, User Sidecars, Surface validation/compilation, fastpath resolution, dependency invalidation, Render Patch and presentation receipts.

### A2UI Runtime

Owns deterministic Surface hydration, entity cache, binding dereference, layout/slot/repeat, catalog component loading and action-event forwarding. It does not make business decisions.

### Business Engine

Continues to own Entity facts, action declarations, guard/schema judgment, confirmation, effects and business replay. Presentation events must not change the Business Snapshot hash.

## Protocols

### Thin Chat Request

```ts
interface PresentationRequest {
  requestId: string;
  principal: string;
  subject: RenderSubject;
  intent: string;
  constraints?: RenderConstraint[];
  delivery: 'inline' | 'canvas' | 'auto';
  sourceMessageIds: string[];
}

interface PresentationReceipt {
  requestId: string;
  status: 'ready' | 'pending' | 'fallback' | 'failed';
  sidecar?: { id: string; version: number };
  surfaceUrl?: string;
  reasonCode?: string;
}
```

The request grants no new read permission. Broker/hydration reauthorize every root and traversal. Chat context may retain only subject, intent and active Sidecar id/version.

### Render Situation

```ts
interface RenderSituation {
  roots: EntityRef[];
  intent: string;
  lens: DataLens;
  audience: {
    principal: string;
    role?: string;
    policyScope: string;
    deviceClass?: string;
  };
  budget: { maxDepth: number; maxNodes: number };
}
```

Data Lens supports only bounded `self/members/selection/relations/flow/graph` traversal. It is not a general query language.

### Application Render Recipe

```ts
interface ApplicationRenderRecipe {
  key: {
    application: string;
    applicationVersion: number;
    scenario: string;
    subjectShape: string;
    intent: string;
    catalogVersion: string;
  };
  situationTemplate: RenderSituationTemplate;
  surfaceTemplate: SurfaceTreeTemplate;
  dependencies: ContractDependency[];
  status: 'candidate' | 'promoted' | 'stale';
  provenance: { model: string; generatedAt: string };
}
```

Recipe contains no principal, session id, live Entity values or user preference. Subject/data slots are instantiated only after runtime authorization. A candidate can serve as a mechanically valid low-priority fastpath; promotion makes it the shared preferred Recipe and requires human approval.

### User Render Sidecar

```ts
interface UserRenderSidecar {
  owner: { principal: string; policyScope: string };
  key: {
    subject: RenderSubject;
    intent: string;
    deviceClass?: string;
  };
  recipeRef?: { id: string; version: number };
  surface: NormalizedSurfaceTree;
  dependencies: RenderDependency[];
  patches: RenderPatch[];
  retention: 'cache' | 'pinned';
  version: number;
}
```

There is no Session Sidecar. Valid generated results automatically become user-level `cache`; “以后都这样” changes retention to `pinned`. Session may hold an uncommitted preview, active pointer or transient expanded state only.

### Runtime Surface Instance

An instance is ephemeral hydrated A2UI state. It contains current values/guards and is never the persisted source. Chat inline and Canvas hydrate the same Sidecar id/version.

## Application-level Pre-generation

Definition activation schedules, but does not block on, this pipeline:

```text
application/flow/capability/catalog definitions
        ↓ mechanical scenario enumeration
scenario descriptors
        ↓ separate Presentation Agent context
parameterized Surface templates
        ↓ binding/catalog/dependency validation
versioned candidate Recipes
```

Scenario Enumerator derives semantic skeletons such as application overview, entity inspection, collection browsing, selection comparison, current Flow task, confirmation review and artifact inspection. It never chooses concrete components or contains business-name routing.

Triggers include Application/Flow/Catalog activation, dependency invalidation, repeated missing situations and quality feedback. Regeneration failures are recorded in the Presentation event domain and never block Chat, direct Renderer or Application activation.

## Runtime Resolution

```text
user pinned
→ user cache
→ promoted application recipe
→ validated candidate recipe
→ generic renderer
→ runtime Presentation Agent
```

Every candidate is reauthorized and dependency-validated before hydration. Application Recipe hit uses zero Presentation LLM calls; User Sidecar hit uses zero Chat and Presentation LLM calls. Direct navigation and Flow transition use the same Broker without a Chat Session.

## Entity, Entities, Flow and Graph Composition

- Single Entity: identity/status/content/metadata/action/relation regions.
- Entities: collection layout + `repeat` + reusable item recipe; membership changes rehydrate without invalidating outer layout.
- Selection: explicit authorized roots with source isolation.
- Flow: stable Shell with Current Task/Context/Output/History child Sidecars; node transition invalidates only required slots.
- Graph: bounded nested Surface DAG with per-edge authorization and subtree receipts.

Hierarchical Sidecars reference children; parents never copy child facts. Replaced child trees switch atomically to avoid mixed versions.

## Action Interaction

Surface controls are live projections of current Entity `actions[]`. Before submit, Action Adapter reloads declaration, guard and schema, then calls `/api/exec`. Sidecars never persist enabled state, guard results, form values or confirmation completion. View interactions, Sidecar lifecycle actions and business actions use separate event namespaces.

## Human Optimization

Natural-language changes become thin Revision Requests; Presentation Agent emits constrained semantic Render Patches. Direct manipulation bypasses Chat and produces the same normalized Patch. Patches allow move/collapse/density/compatible-word substitution/pin, but no CSS, pixel facts, arbitrary code or business values.

Personal cache/pinned versions are principal-isolated. Shared promotion abstracts subject slots, strips user/policy-specific content, produces a mechanical diff and requires `actor=human` approval. Rollback moves an active pointer and preserves append-only versions.

## Event and Replay Model

Presentation event families include:

```text
presentation-requested / presentation-resolved / presentation-failed
render-recipe-generated / validated / promoted / staled
user-sidecar-instantiated / revised / pinned / staled / reverted
render-promotion-requested / approved / rejected
surface-hydrated / render-feedback-recorded
```

They may share PostgreSQL append-only storage but fold into a separate Presentation Snapshot. Chat history stores only request/receipt references. Business, LLM plan, human patch, promotion approval and business effect provenance remain distinct.

## Failure Isolation

- Chat answer succeeds even if Presentation planning fails.
- Existing User Sidecar/Application Recipe works when either LLM is unavailable.
- New natural-language planning fails honestly without rule fallback.
- Invalid Recipe/Sidecar falls back to generic Renderer and exposes no action from the rejected plan.
- Policy change can invalidate cached presentation without deleting history.

## Module Boundaries

```text
packages/shared
  serializable request/receipt/situation/lens/recipe/sidecar/event types

pure presentation kernel (location confirmed by Phase A spike)
  schema, validator, compiler, dependency DAG, invalidation, fold, patch

packages/agent
  thin request choice, Presentation Agent adapter, bounded prompt, explanation

apps/web/src/render
  A2UI runtime, hydration, cache/deref, Surface host, generic fallback

apps/web/src/engine
  Broker, Recipe/Sidecar persistence adapters, resolver and receipts

apps/web/src/components
  inline/canvas hosts, direct manipulation, diff/promotion/revert UI
```

Creating a new workspace package is not assumed. Phase A must compare a pure module under existing packages with a dedicated presentation package and choose the smallest boundary without cycles.

## Governance Tests

- No `sessionId` in persisted Sidecar key/schema.
- No complete catalog/Surface/dependency payload in Chat prompt/history.
- No entity/flow type to fixed page/component production mapping.
- No business names or display-intent keyword routing in Chat route.
- Recipe/Sidecar factual literals are zero.
- Business Snapshot hash is unchanged by Presentation events.
- Every Surface action resolves to a currently authorized Entity action.
