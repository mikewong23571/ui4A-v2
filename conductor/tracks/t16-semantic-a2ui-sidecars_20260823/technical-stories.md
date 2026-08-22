# T16 Technical Stories

> Technical Stories are implementation enablers mapped to user stories S1–S32. They are not substitutes for user acceptance. Each story closes only after its Red→Green evidence and mapped user-story evidence pass.

## TS1 Turn-scoped Thinking Identity

Maps to S2.

Acceptance:

- SSE thinking frames carry `turnId + step`; client state uses the compound identity.
- Ten consecutive turns with step 1 never replace or relocate prior reasoning.
- Refresh/recovery preserves the chosen thinking retention policy without cross-turn attachment.
- Component, SSE integration and real browser tests pass.

## TS2 Render Capability Truth

Maps to S1 and S3.

Acceptance:

- Static “render 未实现” prompt/tool text is removed.
- Chat sees only thin Presentation Request capability; Presentation Agent reads live catalog/version.
- Markdown answer distinguishes chat support, catalog word and field content type.
- Source governance prevents hard-coded current catalog state in product prompts.

## TS3 Thin Presentation Request/Receipt

Maps to S4–S12 and S23.

Acceptance:

- Chat request schema contains subject/intent/constraints/delivery/sources but no Surface/component/bind.
- Receipt contains status and optional Sidecar/surface reference only.
- Request grants no data access and is idempotent by requestId.
- Direct navigation and Flow transition use the same protocol without Chat.
- Real LLM variants correctly decide when to request presentation without keyword routes.

## TS4 Presentation Broker and Failure Isolation

Maps to S9, S18 and S23.

Acceptance:

- Broker authorizes, builds Situation, resolves Sidecars/Recipes and returns one terminal receipt.
- Chat answer/outcome is unchanged when Presentation planning fails or times out.
- Presentation can complete after Chat response and correlate by requestId/turnId without entering raw dialogue.
- Retry produces no duplicate User Sidecar or terminal receipt.

## TS5 Render Situation and Authorized Data Lens

Maps to S4–S10 and S29.

Acceptance:

- Versioned schema covers roots, intent, audience/policy and budgets.
- Lens supports only self/members/selection/relations/flow/graph.
- Every traversal is reauthorized and `maxDepth/maxNodes` always holds.
- Unauthorized node identity/count leakage is zero under property/fuzz tests.

## TS6 Scenario Enumerator

Maps to S1, S5, S7, S8 and S12.

Acceptance:

- Same Application definitions yield the same scenario inventory.
- New Flow/node/action activation creates relevant descriptors without product code changes.
- Output describes semantic situations, not Surface components or page names.
- Enumerator contains no business entity/action keyword branches.

## TS7 Application Recipe Generation

Maps to S9–S12 and S23.

Acceptance:

- Separate Presentation Agent receives definitions, scenario, catalog and bounded examples, not Chat history.
- Generated template contains subject slots and zero live values/principal/session identifiers.
- Validator checks bindings, dependencies, catalog and definition versions.
- Failure is auditable and does not block Application activation, Chat or direct Renderer.

## TS8 Recipe Registry and Regeneration

Maps to S12, S17, S21 and S27.

Acceptance:

- Registry supports candidate/promoted/stale/version and deterministic keys.
- Definition/Catalog changes scan only affected dependencies.
- Compatible old Recipe remains usable until replacement; incompatible Recipe immediately stops interaction.
- Promotion requires human approval and supports rollback.
- Regeneration job is retry-safe and non-blocking.

## TS9 Semantic Roles and Generic Fallback

Maps to S4, S7, S9, S12 and S30.

Acceptance:

- identity/status/primary-content/metadata/relation roles are application semantics, not CSS.
- Entity identity never falls back to node title when an identity role exists.
- Missing roles produce a readable/actionable generic Renderer.
- Source scan contains no entity type to fixed page/component mapping.

## TS10 Multi-region Surface Tree and A2UI Compiler

Maps to S9–S12 and S30.

Acceptance:

- Schema supports layout/slot/repeat/multiple catalog words and binding-only nodes.
- Normalization is deterministic; serialize/restore/compile preserves the model.
- Each subtree carries independent bindings/dependencies/provenance.
- Invalid subtree is isolated; verified siblings remain usable.
- Unknown word or literal fact fails before interaction.

## TS11 Entity/Entities/Flow/Graph Runtime

Maps to S4–S8, S19, S20 and S22.

Acceptance:

- Single Entity, collection repeat/item recipe, explicit selection, Flow Shell/slots and bounded graph render through one runtime.
- Membership changes rehydrate without replanning the collection layout.
- Flow transition preserves Shell and refreshes only affected node slots.
- Parent Sidecar never copies child facts; subtree replacement is atomic.

## TS12 Surface Action Adapter

Maps to S13–S17.

Acceptance:

- Every control maps to a live Entity action with exact rel/action.
- Fieldless, schema form, high-risk and member actions pass focused browser stories.
- Before submit, declaration/guard/schema are reloaded; stale action yields zero POST.
- Sidecar persists no guard/enabled/formData state.
- Fuzz contract-outside action submission count is zero.

## TS13 User-level Sidecar Event Model

Maps to S18–S28 and S31.

Acceptance:

- Sidecar key includes principal/policy/subject/intent/device but never sessionId.
- Retention is `cache | pinned`; cache is evictable, pinned is versioned and durable.
- Events fold into separate Presentation Snapshot; Business Snapshot hash remains unchanged.
- Writes/retries are idempotent; all versions and active pointers replay.
- Cross-principal cache hits are impossible.

## TS14 User Sidecar Resolver and Fastpath

Maps to S18, S19, S21 and S23.

Acceptance:

- Lookup is user pinned → user cache → promoted Recipe → candidate Recipe → generic → planner.
- User hit makes Chat and Presentation LLM call count zero before first Surface.
- Recipe hit makes Presentation LLM call count zero and instantiates one User Sidecar.
- Cross-Session Chat/Canvas/direct navigation resolves the same User Sidecar.
- Local first usable fastpath Surface target is ≤500ms.

## TS15 Dependency DAG and Partial Invalidation

Maps to S17, S20–S22 and S29.

Acceptance:

- Manifest records rel/pointers/contract fingerprint/optional plus catalog/definition/policy versions.
- Value/membership changes rehydrate; incompatible schema/action/catalog/policy always stale.
- Incorrect fastpath reuse rate is zero.
- Only invalid subtrees are replanned with bounded context; receipt lists reused/replanned ids.

## TS16 Human Render Patch and User Memory

Maps to S24–S26 and S28.

Acceptance:

- Chat natural language produces a thin Revision Request; Presentation Agent emits normalized Patch.
- Direct manipulation bypasses Chat and yields the same Patch operations.
- Patch allows semantic move/collapse/density/compatible-word/pin only; no CSS/code/facts.
- baseVersion optimistic concurrency prevents silent overwrite.
- User cache/pinned results persist across Sessions and can be reverted.

## TS17 Shared Recipe Promotion

Maps to S27 and S28.

Acceptance:

- Promotion abstracts subject slots and strips principal/entity values from a pinned User Sidecar.
- Mechanical diff compares candidate with current promoted Recipe.
- Only actor=human approval activates a new shared version.
- Reject/rollback preserves immutable history and revalidates before reuse.

## TS18 Presentation Observability, Explanation and Eval

Maps to S1–S32, especially S31/S32.

Acceptance:

- Presentation request/receipt, recipe, sidecar, hydration, invalidation, patch and promotion events have distinct provenance.
- Chat history stores references only; no complete Surface/catalog/dependency payload.
- Explanation is event-derived and separates business facts, LLM plan, user patch and human approval.
- Eval records hit path, both LLM call counts, dependency result, first usable time, business diff and accessibility/visual rubrics.
- Mechanical Safety 100%, AI story variants ≥80%, browser completion 100%, engineering/human visual rubrics ≥4/5.
