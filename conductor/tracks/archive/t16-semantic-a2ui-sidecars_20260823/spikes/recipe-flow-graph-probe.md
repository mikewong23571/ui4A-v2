# Application Recipe and Flow/Graph Lens Probe

## Outcome

The current definition language is sufficient to enumerate the required presentation situations
mechanically. For the `publishing` application, one stable pass produces 15 descriptors: one
application overview, two flow inspections, eight current-task variants, one collection browse,
two confirmation reviews, and one artifact inspection. Descriptor and Recipe templates can contain
only definition references and runtime slots; they need no live entity value, `principal`, or
`sessionId`.

The runtime Lens should remain a small authorized graph, not a copy of an Application definition.
The largest representative Lens below permits five entities at depth one. Definition context for
planning is also bounded: the complete minified `publishing` definition context is 4,555 bytes,
while an individual flow is 1,650–1,994 bytes.

This was a disposable, read-only probe. No production types or runtime were added.

## Current-source evidence

- The application owns intent, while flow membership is derived from `flow.app`; there is no
  application-owned member list (`packages/shared/src/definition.ts:167-197`). The built-in
  `publishing` intent and its two flows are declared in
  `apps/web/src/applications/ui4a-walkthrough.bundle.json:13-17,79-379`.
- `article-drafting` has five nodes and five actions. Its `publish` effect structurally declares an
  `articles` collection, `post` resource shape, `post-status` target flow, and `published` target
  node (`ui4a-walkthrough.bundle.json:81-252,205-240`).
- `post-status` has three nodes and five actions. `archive` and `save-summary` carry high-risk
  confirmation markers; `generate-summary` structurally spawns `summarize`
  (`ui4a-walkthrough.bundle.json:255-379`). The capability scope and schemas are definition data
  (`ui4a-walkthrough.bundle.json:34-60`).
- Flow edges and reachability already have deterministic pure helpers
  (`packages/shared/src/definition.ts:318-383`). Scenario enumeration should reuse those semantics
  rather than interpret display titles.
- Siren already exposes the runtime graph primitives: instances have current node, fields, actions,
  collection/artifact links; collections embed members; artifacts link to their source; confirmations
  link to their target (`packages/engine/src/siren.ts:145-313`).
- Artifact provenance and source integrity are explicit and replayable
  (`packages/engine/src/capability-artifact.ts:3-74`). A pending confirmation preserves target,
  action, request, proposer, policy, and risk (`packages/engine/src/confirmation.ts:113-203`).
- There is currently no production `ApplicationRenderRecipe`, `ScenarioDescriptor`,
  `RenderSituation`, `DataLens`, or `UserRenderSidecar` implementation. The current Canvas path
  still selects `component: 'detail'` (`apps/web/src/components/canvas-body.tsx:237`), and the current
  RenderSpec is a single component (`apps/web/src/render/spec.ts:55-63`).

Commands used:

```sh
jq '{publishingFlows: [.flows[] | select(.app=="publishing") | ...],
     highRisk: [...], spawns: [...], appends: [...]}' \
  apps/web/src/applications/ui4a-walkthrough.bundle.json

rg -n 'ApplicationRenderRecipe|ScenarioDescriptor|RenderSituation|DataLens|UserRenderSidecar' \
  apps packages

for flow_name in article-drafting post-status; do
  jq -c --arg flow_name "$flow_name" '.flows[] | select(.name==$flow_name)' \
    apps/web/src/applications/ui4a-walkthrough.bundle.json | wc -c
done
```

The first command reported 5/5 and 3/5 node/action counts, two high-risk actions, one spawn, and one
append target. The implementation scan returned no matches. The size probe reported 1,994 bytes for
`article-drafting`, 1,650 for `post-status`, 697 for `summarize`, and 4,555 for the complete scoped
`publishing` context.

## Mechanical scenario enumeration

Enumeration must be a pure fold over activated definitions, ordered by declaration order and keyed
by definition version. It may copy stable identifiers from definitions, but must not choose a word,
component, route, or page.

| Structural predicate | Descriptor kind | `publishing` inventory |
| --- | --- | ---: |
| One active application | `application-overview` | 1 |
| One active flow | `entity-inspect` | 2 |
| One reachable flow node | `current-task` | 8 |
| `append` effect with collection target | `collection-browse` | 1 |
| Action with `requires-confirmation=high` | `confirmation-review` | 2 |
| `spawn` effect whose capability has an output schema | `artifact-inspect` | 1 |

Terminal nodes are still current-task descriptors: they communicate completion and intentionally
have no action region. A node with multiple qualifying actions emits one current-task descriptor plus
specialized confirmation/artifact descriptors; it does not duplicate the whole page description.

Representative descriptors:

```json
[
  {
    "key": "publishing@1/application-overview",
    "kind": "application-overview",
    "subjectShape": "application:publishing",
    "intent": "overview",
    "definitionRefs": ["application:publishing@1", "flow:article-drafting@1", "flow:post-status@1"],
    "slots": ["subject.rel"]
  },
  {
    "key": "publishing@1/article-drafting@1/current-task/ready",
    "kind": "current-task",
    "subjectShape": "flow-instance:article-drafting",
    "intent": "continue-current-task",
    "definitionRefs": ["flow:article-drafting@1#node/ready"],
    "slots": ["subject.rel", "subject.node"]
  },
  {
    "key": "publishing@1/article-drafting@1/collection-browse/articles",
    "kind": "collection-browse",
    "subjectShape": "collection:articles",
    "intent": "browse-members",
    "definitionRefs": ["flow:article-drafting@1#node/ready/action/publish/effect/append"],
    "slots": ["subject.rel", "members"]
  },
  {
    "key": "publishing@1/post-status@1/confirmation-review/archive",
    "kind": "confirmation-review",
    "subjectShape": "confirmation:pending",
    "intent": "review-proposed-effect",
    "definitionRefs": ["flow:post-status@1#node/published/action/archive"],
    "slots": ["subject.rel", "target.rel", "target.action"]
  },
  {
    "key": "publishing@1/post-status@1/artifact-inspect/summarize",
    "kind": "artifact-inspect",
    "subjectShape": "capability-artifact:summarize",
    "intent": "inspect-provenance-and-output",
    "definitionRefs": ["flow:post-status@1#node/published/action/generate-summary", "capability:summarize@1"],
    "slots": ["subject.rel", "source.rel"]
  }
]
```

These descriptors contain definition identifiers and slot names only. A recursive key scan over the
sample found zero `principal`/`sessionId` keys; a leaf-value comparison against seeded values from
`ui4a-walkthrough.bundle.json:440-528` found zero matches. Production validation should perform the
same recursive checks on the generated Recipe template, not rely on prompt instructions.

## Bounded Lens probes

The following are proposed semantic probe shapes, not final shared schemas. `slot` is instantiated
only after Broker authorization. `limit` and the global budget are both mandatory so one malformed
or highly connected entity cannot expand the graph unboundedly.

### `article-drafting` current task

```json
{
  "version": 1,
  "roots": [{ "slot": "subject.rel", "shape": "flow-instance:article-drafting" }],
  "intent": "current-task",
  "lens": {
    "kind": "flow",
    "include": ["self", "current-node", "current-fields", "current-actions", "recent-history"],
    "historyLimit": 5
  },
  "budget": { "maxDepth": 1, "maxNodes": 2 }
}
```

Serialized size: 274 bytes. One entity projection already contains the current node/fields/actions;
the optional second node is the authorized flow-definition projection. Recent history is a bounded
event slice, not another authoritative entity and not copied into the Recipe.

### `post-status` entity plus relations

```json
{
  "version": 1,
  "roots": [{ "slot": "subject.rel", "shape": "flow-instance:post-status" }],
  "intent": "inspect",
  "lens": {
    "kind": "graph",
    "edges": [{ "rel": "collection", "limit": 1 }, { "rel": "artifact", "limit": 3 }],
    "include": ["self", "current-node", "fields", "actions"]
  },
  "budget": { "maxDepth": 1, "maxNodes": 5 }
}
```

Serialized size: 285 bytes. This reads at most the post, its collection, and three artifacts. It does
not traverse collection members, so opening one post cannot disclose sibling identities.

### Artifact and confirmation

```json
{
  "artifact": {
    "roots": [{ "slot": "subject.rel", "shape": "capability-artifact:*" }],
    "intent": "artifact-inspection",
    "lens": { "kind": "relations", "edges": [{ "rel": "source", "limit": 1 }] },
    "budget": { "maxDepth": 1, "maxNodes": 2 }
  },
  "confirmation": {
    "roots": [{ "slot": "subject.rel", "shape": "confirmation:pending" }],
    "intent": "confirmation-review",
    "lens": { "kind": "relations", "edges": [{ "rel": "target", "limit": 1 }] },
    "budget": { "maxDepth": 1, "maxNodes": 2 }
  }
}
```

The full probe forms measured 253 and 259 bytes respectively. Artifact traversal stops at its source;
confirmation traversal stops at its target. Approval/rejection is always projected from the live
confirmation entity and rejudged, never encoded as an assumed Recipe state.

## Hierarchical Recipe recommendation

Use a stable parent shell and referenced child Recipes/Sidecars:

```text
FlowShell(flow definition + subject shape)
├── CurrentTask(subject.node + node contract fingerprint)
├── Context(subject field/link pointers)
├── Output(artifact relation membership + child artifact sidecars)
└── History(flow-instance event cursor, bounded)
```

For collections, retain the collection shell and item Recipe, while membership is hydrated through
`repeat`. For a graph, the parent stores child references and edge receipts only. It must not copy a
child's fields or hydrated facts. Child replacement is an active-pointer swap after the entire child
validates, preventing mixed old/new versions.

## Dependency and invalidation recommendations

Recipe dependencies should be structural and path-addressable:

- application definition version/hash and only the referenced application fields;
- flow definition version plus node/action/field/effect JSON-pointer fingerprints;
- capability definition/schema hash for artifact scenarios;
- Surface schema/enumerator versions and catalog version plus used-word schema hashes;
- subject-shape and slot contracts, never the subject's live value.

Runtime Sidecar dependencies should add authorized entity rel + property/link/action pointers,
collection membership hashes, current node, policy version, and child Sidecar ids/versions. Preserve
the existing coarse sitemap content hash (`packages/engine/src/sitemap.ts:227-230,320-326`) as a
fail-safe, but do not make it the normal invalidation unit: today the page cache clears globally on
any sitemap version change (`apps/web/src/render/entity-cache.ts:69-78`).

| Change | Rehydrate | Stale/replan |
| --- | --- | --- |
| Field value or artifact content changes | affected value/content subtree | none |
| Collection membership changes | `repeat` members and count | item Recipe only if member shape is incompatible |
| Flow node transition | CurrentTask/Output/History children | old node child; retain FlowShell |
| Guard result or confirmation status changes | action/decision child | no layout Recipe; interaction is disabled until live recheck |
| Field/action schema, risk, guard, effect, or node contract changes | unaffected siblings | descriptors/Recipes depending on that exact pointer |
| Capability input/output schema or scope changes | existing compatible artifacts | artifact/spawn Recipe dependencies |
| Catalog word schema removed/incompatible | verified sibling regions | every subtree using that word; interaction fails closed immediately |
| Application title/intent changes | application header | application overview Recipe only |
| Policy/principal scope changes | all authorized data/action bindings | User Sidecar policy dependency; never share across principals |
| Linked source/target disappears or becomes unauthorized | keep verified parent read-only | referenced child only, with zero identity/count leakage |

Instance fingerprints must respect `bornVersion`: Siren resolves an instance against its birth
definition before projecting current actions (`packages/engine/src/siren.ts:145-178`). Therefore,
invalidating solely by the latest flow version would incorrectly reuse a Recipe for in-flight older
instances. Key the child contract dependency by resolved definition version/hash, while Application
Recipe generation remains keyed to the activated version.

## Phase A decisions supported

1. Build Scenario Enumerator as a pure definition fold. No LLM, component choice, entity-type route,
   or business keyword branch belongs there.
2. Generate one parameterized candidate Recipe per descriptor in an isolated Presentation context;
   validate recursive absence of live facts, `principal`, and `sessionId` before registration.
3. Keep Lens resolution runtime-only and authorization-first. A Recipe may name allowed relation
   classes and slots, but never pre-resolve their values.
4. Prefer hierarchical dependencies and pointer-level invalidation, with sitemap/catalog global
   version changes retained as conservative fallback.
5. Treat artifact and confirmation as ordinary graph entities with specialized semantic roles, not
   special pages. All actions still come from the live Siren projection.

