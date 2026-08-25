# A2UI v0.9 Disposable Probe

## Outcome

The installed A2UI runtime is sufficient as T16's **deterministic hydration and React
adapter**, including multi-component trees, basic layout, referenced children, repeated item
templates, reactive data updates and action events. It is not a persistence format or a complete
Sidecar runtime: there is no public `serialize`, `restore`, component-delete or separate catalog
version API. T16 should persist its own normalized, binding-only Surface Tree and compile it to a
replayable A2UI message bundle at the runtime boundary.

Probe date: 2026-08-23. No production code or dependency was changed.

## Installed API and source evidence

- `@a2ui/web_core` is `0.10.6`; `@a2ui/react` is `0.10.2`. Both expose an explicit
  `v0_9` entry point. The unversioned web-core entry still points to v0.8, so T16 must continue
  importing `@a2ui/*/v0_9` explicitly. See the installed package manifests
  (`@a2ui/web_core/package.json:2-35`, `@a2ui/react/package.json:2-56`).
- `MessageProcessor` owns a `SurfaceGroupModel`, accepts `createSurface`, `updateComponents`,
  `updateDataModel` and `deleteSurface`, and resolves the catalog only by exact `catalogId`
  (`processing/message-processor.js:33-57,175-226`).
- `updateComponents` validates the whole message before mutation, then upserts existing IDs;
  changing a component type recreates that component (`message-processor.js:228-280`). There is
  no `deleteComponent` message.
- Basic `Row`/`Column`/`List` accept either static child IDs or the repeat template
  `{componentId, path}`. `Card.child`, `Button.child`, `Tabs.tabs[].child` and modal children are
  typed component references rather than a generic named-slot facility
  (`schema/common-types.js:58-90`, `basic_components.js:162-235,275-289`).
- The React renderer starts at component ID `root`; `buildChild(id, basePath)` recursively renders
  references. A repeated child reuses one component definition with an item-specific base path
  (`@a2ui/react/v0_9/index.js:1-100,390-461`).
- Server events carry `name`, `surfaceId`, `sourceComponentId`, timestamp and resolved dynamic
  context through the processor action handler (`state/surface-model.js:42-74`).
- Protocol/capability versions supported by this release are `v0.9` and `v0.9.1`. A catalog has
  an ID and optional inline definition, but no separate `catalogVersion` field. Version therefore
  has to be encoded into, or fingerprinted alongside, the ID.

## Executable probe

The disposable probe was executed directly through stdin, so it created no source or temporary
file. This is the minimal reproducer (run from the repository root):

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {
  ButtonApi, CardApi, Catalog, ColumnApi, ComponentContext,
  GenericBinder, ListApi, MessageProcessor, TextApi,
} from './apps/web/node_modules/@a2ui/web_core/src/v0_9/index.js';

const catalogId = 'urn:ui4a:a2ui-probe:catalog@1';
const catalog = new Catalog(catalogId, [ColumnApi, ListApi, CardApi, TextApi, ButtonApi]);
const actions = [];
const processor = new MessageProcessor([catalog], async (action) => actions.push(action));
const initial = [
  { version: 'v0.9', createSurface: { surfaceId: 'probe', catalogId, sendDataModel: true } },
  { version: 'v0.9', updateDataModel: { surfaceId: 'probe', path: '/', value: {
    title: 'Articles', items: [{ name: 'One' }, { name: 'Two' }], selected: 'post:one',
  } } },
  { version: 'v0.9', updateComponents: { surfaceId: 'probe', components: [
    { id: 'root', component: 'Column', children: ['heading', 'card', 'list', 'action'] },
    { id: 'heading', component: 'Text', text: { path: '/title' }, variant: 'h1' },
    { id: 'card', component: 'Card', child: 'card-text' },
    { id: 'card-text', component: 'Text', text: 'single-child slot' },
    { id: 'list', component: 'List', children: { componentId: 'item', path: '/items' } },
    { id: 'item', component: 'Text', text: { path: 'name' } },
    { id: 'action', component: 'Button', child: 'action-label', action: {
      event: { name: 'open', context: { rel: { path: '/selected' } } },
    } },
    { id: 'action-label', component: 'Text', text: 'Open' },
  ] } },
];
processor.processMessages(initial);
const surface = processor.model.getSurface('probe');
assert.equal([...surface.componentsModel.entries].length, 8);
assert.equal(surface.componentsModel.get('card').properties.child, 'card-text');

const list = new GenericBinder(new ComponentContext(surface, 'list'), ListApi.schema);
const item = new GenericBinder(new ComponentContext(surface, 'item', '/items/0'), TextApi.schema);
const listSub = list.subscribe(() => {});
const itemSub = item.subscribe(() => {});
assert.deepEqual(list.snapshot.children, [
  { id: 'item', basePath: '/items/0' }, { id: 'item', basePath: '/items/1' },
]);

const incremental = [
  { version: 'v0.9', updateDataModel: { surfaceId: 'probe', path: '/items/0/name', value: 'One+' } },
  { version: 'v0.9', updateDataModel: { surfaceId: 'probe', path: '/items', value:
    [{ name: 'One+' }, { name: 'Two' }, { name: 'Three' }] } },
  { version: 'v0.9', updateComponents: { surfaceId: 'probe', components:
    [{ id: 'heading', text: 'Updated heading', variant: 'h2' }] } },
];
processor.processMessages(incremental);
assert.equal(item.snapshot.text, 'One+');
assert.equal(list.snapshot.children.length, 3);

const button = new GenericBinder(new ComponentContext(surface, 'action'), ButtonApi.schema);
const buttonSub = button.subscribe(() => {});
button.snapshot.action();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(
  { name: actions[0].name, source: actions[0].sourceComponentId, context: actions[0].context },
  { name: 'open', source: 'action', context: { rel: 'post:one' } },
);

const serialized = JSON.stringify([...initial, ...incremental]);
const restored = new MessageProcessor([catalog]);
restored.processMessages(JSON.parse(serialized));
const restoredSurface = restored.model.getSurface('probe');
const trees = (value) => [...value.componentsModel.entries]
  .map(([, component]) => component.componentTree).sort((a, b) => a.id.localeCompare(b.id));
assert.deepEqual(restoredSurface.dataModel.get('/'), surface.dataModel.get('/'));
assert.deepEqual(trees(restoredSurface), trees(surface));

const caps = processor.getClientCapabilities({ includeInlineCatalogs: true });
assert.deepEqual(caps['v0.9'].supportedCatalogIds, [catalogId]);
assert.equal('catalogVersion' in caps['v0.9'].inlineCatalogs[0], false);
console.log('PASS: components=8 repeat=3 action=1 restore=equivalent catalogVersion=false');
listSub.unsubscribe(); itemSub.unsubscribe(); buttonSub.unsubscribe();
NODE
```

Observed result:

```text
PASS: components=8 repeat=3 action=1 restore=equivalent catalogVersion=false
```

The first probe intentionally read only `GenericBinder.snapshot`; the later data assertion stayed
at `One` instead of `One+`. Adding `subscribe()` made the probe pass. Incremental binding is
consumer-driven; React's `createComponentImplementation` supplies that subscription. This matters
because UI4A's ten custom words currently use `createBinderlessComponentImplementation` and
one-shot `resolveDynamicValue`, explicitly disabling reactive updates after a prior render-loop
failure (`apps/web/src/render/canvas/word-catalog.tsx:56-88`). Basic layout/text/action components
are reactive; current custom words require affected-Surface rebuild until safely adapted.

## Capability findings

| Concern | Result | Constraint for T16 |
| --- | --- | --- |
| Multi-component Surface | Pass | Flat ID map with one `root`; hierarchy is expressed by child references. |
| Layout | Pass | `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`; layout vocabulary remains catalog-defined. |
| Slot | Partial | Typed child-reference properties exist; semantic/named slots must be normalized by UI4A and compiled. |
| Repeat | Pass | `{componentId,path}` repeats a reusable item subtree with relative per-item bindings. |
| Incremental data | Pass | JSON-pointer updates notify subscribed binders. Binderless UI4A words do not receive them. |
| Incremental components | Pass with limits | Atomic validation per message and ID upsert; no component delete or transaction spanning data + components. |
| Events | Pass | Event context bindings resolve at interaction time; UI4A Action Gate must still reauthorize before `/api/exec`. |
| Serialization/restore | Partial | JSON message-log replay restores equivalent model; live SDK models have no public serializer/restore API. |
| Catalog version | Partial | Protocol `v0.9`/`v0.9.1`; catalog identity is only `catalogId`, with no independent version/fingerprint. |

## Existing UI4A gap

The current SDK integration already uses the correct runtime pieces, but `planSurface` emits exactly
one component (`id: root`) for one `RenderSpec` (`apps/web/src/render/canvas/surface-flow.ts:83-130`).
Canvas focus also selects the fixed `detail` word, and every action reload rebuilds the whole Canvas.
The local runtime catalog combines 18 A2UI basic components with 10 UI4A words
(`word-catalog.tsx:91-128`), while `/api/render/catalog` is generated from only the 10 custom words
and negotiation compares only the stable ID (`registry.ts:259-272`,
`components/canvas-body.tsx:213-222`). T16 must make catalog content and dependency identity explicit,
not infer compatibility from a matching URI alone.

`@a2ui/react@0.10.2` also exports `./styles/structural.css` in its manifest although that file is
absent; `v0_9/index.css` exists and basic styles are currently injected at runtime. This is an SDK
packaging limitation, not a reason to add another styling dependency.

## Verification evidence

```bash
node --test \
  "$PWD/node_modules/.pnpm/@a2ui+web_core@0.10.6/node_modules/@a2ui/web_core/src/v0_9/processing/message-processor.test.js"
# 30 passed, 0 failed

node --test \
  "$PWD/node_modules/.pnpm/@a2ui+web_core@0.10.6/node_modules/@a2ui/web_core/src/v0_9/rendering/component-context.test.js" \
  "$PWD/node_modules/.pnpm/@a2ui+web_core@0.10.6/node_modules/@a2ui/web_core/src/v0_9/rendering/generic-binder.test.js" \
  "$PWD/node_modules/.pnpm/@a2ui+web_core@0.10.6/node_modules/@a2ui/web_core/src/v0_9/state/component-model.test.js" \
  "$PWD/node_modules/.pnpm/@a2ui+web_core@0.10.6/node_modules/@a2ui/web_core/src/v0_9/state/data-model.test.js" \
  "$PWD/node_modules/.pnpm/@a2ui+web_core@0.10.6/node_modules/@a2ui/web_core/src/v0_9/state/surface-components-model.test.js" \
  "$PWD/node_modules/.pnpm/@a2ui+web_core@0.10.6/node_modules/@a2ui/web_core/src/v0_9/state/surface-group-model.test.js" \
  "$PWD/node_modules/.pnpm/@a2ui+web_core@0.10.6/node_modules/@a2ui/web_core/src/v0_9/state/surface-model.test.js"
# 82 passed, 0 failed

pnpm vitest run apps/web/src/render/canvas/surface-flow.test.ts \
  apps/web/src/render/canvas/word-catalog.test.tsx
# 2 files passed; 10 tests passed; 0 failed
```

The installed upstream tests directly cover capabilities, create/update/delete, component validation
before mutation, lifecycle events, action propagation, component trees, data subscriptions and model
disposal. The repository tests cover UI4A message compilation, catalog integration, React rendering
and the Action Gate.

## Recommendation

1. Keep `NormalizedSurfaceTree` and dependency manifests in the pure Presentation kernel. They are
   UI4A contracts and must not expose SDK classes, React types or live facts.
2. Compile each atomic Sidecar subtree to a deterministic A2UI message bundle with a stable `root`,
   binding paths only, `protocolVersion`, `catalogId` and a content-derived catalog fingerprint.
3. Restore by validating the Sidecar/Recipe, reauthorizing and dereferencing current facts, then
   replaying a freshly compiled bundle into a new `MessageProcessor`. Do not persist `SurfaceModel`,
   `DataModel`, guards, enabled state or action context values.
4. Map UI4A semantic regions/slots to catalog-specific `child`/`children` properties in the compiler.
   Repeat should compile to the SDK template only when one authorized reusable item subtree is valid.
5. Prefer full atomic Surface/subtree replacement for structural changes. Use `updateDataModel` for
   value-only updates; avoid relying on unreachable component retention as deletion.
6. Keep the Action Gate as the sole event bridge and live reauthorization point. A2UI event emission
   is transport, not authorization.
7. Generate the Presentation Agent's catalog from the same runtime `Catalog` schemas/capabilities and
   invalidate Recipes/Sidecars by fingerprint. Do not use package version or the current URI-only
   check as proof of compatibility.
