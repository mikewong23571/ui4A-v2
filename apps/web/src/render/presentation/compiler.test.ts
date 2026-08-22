import {
  ComponentContext,
  GenericBinder,
  ListApi,
  MessageProcessor,
  TextApi,
  type A2uiMessage,
} from '@a2ui/web_core/v0_9';
import { PRESENTATION_SURFACE_CATALOG } from '../../engine/presentation/catalog';
import type { SurfaceBinding, SurfaceTree } from '@ui4a/engine';
import { describe, expect, it, vi } from 'vitest';

import { UI4A_A2UI_CATALOG_ADAPTER } from './catalog-adapter';
import {
  compileSurfaceTree,
  replayA2uiBundle,
  restoreA2uiBundle,
  serializeA2uiBundle,
} from './compiler';

const catalogDependency = {
  kind: 'catalog' as const,
  subject: PRESENTATION_SURFACE_CATALOG.id,
  version: PRESENTATION_SURFACE_CATALOG.version,
};
const provenance = [{ kind: 'application-recipe' as const, ref: 'recipe:read' }];

function entityDependency(subject: string, paths: string[]) {
  return { kind: 'entity' as const, subject, version: 'entity-v1', paths };
}

function surface(): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'layout',
      id: 'semantic-root',
      role: 'primary-content',
      layout: 'stack',
      dependencies: [],
      provenance,
      children: [
        {
          kind: 'slot',
          id: 'identity-slot',
          role: 'identity',
          name: 'identity',
          dependencies: [],
          provenance,
          child: {
            kind: 'word',
            id: 'heading',
            role: 'identity',
            word: 'heading',
            bindings: {
              value: { kind: 'property', subject: 'post:first', path: 'properties.fields.title' },
            },
            dependencies: [
              catalogDependency,
              entityDependency('post:first', ['properties.fields.title']),
            ],
            provenance,
          },
        },
        {
          kind: 'layout',
          id: 'summary-row',
          role: 'metadata',
          layout: 'inline',
          dependencies: [],
          provenance,
          children: [
            {
              kind: 'word',
              id: 'state',
              role: 'status',
              word: 'state',
              bindings: {
                value: { kind: 'property', subject: 'post:first', path: 'properties.node' },
              },
              dependencies: [
                catalogDependency,
                entityDependency('post:first', ['properties.node']),
              ],
              provenance,
            },
            {
              kind: 'word',
              id: 'summary',
              role: 'metadata',
              word: 'prose',
              bindings: {
                value: {
                  kind: 'property',
                  subject: 'post:first',
                  path: 'properties.fields.summary',
                },
              },
              dependencies: [
                catalogDependency,
                entityDependency('post:first', ['properties.fields.summary']),
              ],
              provenance,
            },
          ],
        },
        {
          kind: 'repeat',
          id: 'related-posts',
          role: 'relation',
          source: { kind: 'entities', subject: 'articles' },
          dependencies: [entityDependency('articles', ['$entities'])],
          provenance,
          item: {
            kind: 'word',
            id: 'related-heading',
            role: 'identity',
            word: 'heading',
            bindings: { value: { kind: 'item', path: 'properties.fields.title' } },
            dependencies: [catalogDependency],
            provenance,
          },
        },
      ],
    },
  };
}

const facts = new Map<string, unknown>([
  ['property:post:first:properties.fields.title', 'First post'],
  ['property:post:first:properties.node', 'published'],
  ['property:post:first:properties.fields.summary', 'A short summary'],
  [
    'entities:articles',
    [
      { properties: { fields: { title: 'First post' } } },
      { properties: { fields: { title: 'Second post' } } },
    ],
  ],
]);

function bindingKey(binding: SurfaceBinding): string {
  if (binding.kind === 'property') return `${binding.kind}:${binding.subject}:${binding.path}`;
  if (binding.kind === 'item') return `${binding.kind}:${binding.path}`;
  return `${binding.kind}:${binding.subject}`;
}

function deref(binding: SurfaceBinding): unknown {
  return facts.get(bindingKey(binding));
}

function messagesOf(bundle: { messages: A2uiMessage[] }): A2uiMessage[] {
  return bundle.messages;
}

describe('normalized Surface Tree to A2UI v0.9 compiler', () => {
  it('maps layout/slot/repeat/semantic words and hydrates facts only through updateDataModel', () => {
    const bundle = compileSurfaceTree(surface(), {
      surfaceId: 'post-first-read',
      catalog: PRESENTATION_SURFACE_CATALOG,
      catalogAdapter: UI4A_A2UI_CATALOG_ADAPTER,
      expectedCatalogFingerprint: UI4A_A2UI_CATALOG_ADAPTER.fingerprint,
      deref,
    });

    expect(bundle.issues).toEqual([]);
    expect(messagesOf(bundle).map((message) => Object.keys(message)[1])).toEqual([
      'createSurface',
      'updateDataModel',
      'updateComponents',
    ]);
    const componentMessage = bundle.messages[2] as Extract<
      A2uiMessage,
      { updateComponents: unknown }
    >;
    const componentJson = JSON.stringify(componentMessage);
    const dataJson = JSON.stringify(bundle.messages[1]);

    expect(componentMessage.updateComponents.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'root', component: 'Column' }),
        expect.objectContaining({ component: 'Row' }),
        expect.objectContaining({ component: 'List' }),
        expect.objectContaining({ component: 'Text', variant: 'h1' }),
      ]),
    );
    expect(componentJson).not.toContain('First post');
    expect(componentJson).not.toContain('A short summary');
    expect(dataJson).toContain('First post');
    expect(dataJson).toContain('A short summary');

    const replay = replayA2uiBundle(bundle, UI4A_A2UI_CATALOG_ADAPTER);
    const runtimeSurface = replay.processor.model.getSurface(bundle.surfaceId);
    expect(runtimeSurface).toBeDefined();
    expect([...runtimeSurface!.componentsModel.entries]).toHaveLength(
      componentMessage.updateComponents.components.length,
    );

    const listComponent = componentMessage.updateComponents.components.find(
      (component) => component.component === 'List',
    );
    const itemComponent = componentMessage.updateComponents.components.find((component) =>
      component.id?.includes('related-heading'),
    );
    expect(listComponent?.id).toBeDefined();
    expect(itemComponent?.id).toBeDefined();
    const list = new GenericBinder<{ children: unknown[] }>(
      new ComponentContext(runtimeSurface!, listComponent!.id!),
      ListApi.schema,
    );
    const item = new GenericBinder<{ text: unknown }>(
      new ComponentContext(runtimeSurface!, itemComponent!.id!, '/ui4a/repeats/related-posts/0'),
      TextApi.schema,
    );
    const listSubscription = list.subscribe(() => undefined);
    const itemSubscription = item.subscribe(() => undefined);
    expect(list.snapshot.children).toHaveLength(2);
    expect(item.snapshot.text).toBe('First post');
    listSubscription.unsubscribe();
    itemSubscription.unsubscribe();
  });

  it('serializes, restores and replays an equivalent processor model', () => {
    const initial = compileSurfaceTree(surface(), {
      surfaceId: 'post-first-read',
      catalog: PRESENTATION_SURFACE_CATALOG,
      catalogAdapter: UI4A_A2UI_CATALOG_ADAPTER,
      expectedCatalogFingerprint: UI4A_A2UI_CATALOG_ADAPTER.fingerprint,
      deref,
    });
    const serialized = serializeA2uiBundle(initial);
    const restored = restoreA2uiBundle(serialized, UI4A_A2UI_CATALOG_ADAPTER);
    const first = replayA2uiBundle(initial, UI4A_A2UI_CATALOG_ADAPTER);
    const second = replayA2uiBundle(restored, UI4A_A2UI_CATALOG_ADAPTER);

    expect(restored).toEqual(initial);
    expect(second.processor.model.getSurface(restored.surfaceId)!.dataModel.get('/')).toEqual(
      first.processor.model.getSurface(initial.surfaceId)!.dataModel.get('/'),
    );
    const trees = (processor: MessageProcessor<never>, surfaceId: string) =>
      [...processor.model.getSurface(surfaceId)!.componentsModel.entries]
        .map(([, component]) => component.componentTree)
        .sort((left, right) => left.id.localeCompare(right.id));
    expect(trees(second.processor as MessageProcessor<never>, restored.surfaceId)).toEqual(
      trees(first.processor as MessageProcessor<never>, initial.surfaceId),
    );
  });

  it('checks the concrete catalog fingerprint before dereference or processor mutation', () => {
    const derefSpy = vi.fn(deref);

    expect(() =>
      compileSurfaceTree(surface(), {
        surfaceId: 'post-first-read',
        catalog: PRESENTATION_SURFACE_CATALOG,
        catalogAdapter: UI4A_A2UI_CATALOG_ADAPTER,
        expectedCatalogFingerprint: 'fnv1a64:stale',
        deref: derefSpy,
      }),
    ).toThrow(/catalog fingerprint/i);
    expect(derefSpy).not.toHaveBeenCalled();
  });

  it('rejects unknown words and literal facts while compiling verified siblings as diagnostics', () => {
    const unknown = surface();
    if (unknown.root.kind !== 'layout') throw new Error('fixture must be a layout');
    unknown.root.children.push({
      kind: 'word',
      id: 'unknown-word',
      role: 'metadata',
      word: 'mystery',
      bindings: {},
      dependencies: [catalogDependency],
      provenance,
    });

    const unknownBundle = compileSurfaceTree(unknown, {
      surfaceId: 'partial-unknown',
      catalog: PRESENTATION_SURFACE_CATALOG,
      catalogAdapter: UI4A_A2UI_CATALOG_ADAPTER,
      expectedCatalogFingerprint: UI4A_A2UI_CATALOG_ADAPTER.fingerprint,
      deref,
    });
    expect(unknownBundle.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unknown-word' })]),
    );
    expect(JSON.stringify(unknownBundle.messages[2])).not.toContain('mystery');
    expect(JSON.stringify(unknownBundle.messages[2])).toContain('diagnostic');
    expect(() => replayA2uiBundle(unknownBundle, UI4A_A2UI_CATALOG_ADAPTER)).not.toThrow();

    const literal = surface() as unknown as {
      schemaVersion: 1;
      root: { children: Array<{ child?: { bindings?: Record<string, unknown> } }> };
    };
    literal.root.children[0]!.child!.bindings!.value = 'leaked literal';
    const literalBundle = compileSurfaceTree(literal as unknown as SurfaceTree, {
      surfaceId: 'partial-literal',
      catalog: PRESENTATION_SURFACE_CATALOG,
      catalogAdapter: UI4A_A2UI_CATALOG_ADAPTER,
      expectedCatalogFingerprint: UI4A_A2UI_CATALOG_ADAPTER.fingerprint,
      deref,
    });
    expect(literalBundle.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'binding-invalid' })]),
    );
    expect(JSON.stringify(literalBundle.messages)).not.toContain('leaked literal');
    expect(() => replayA2uiBundle(literalBundle, UI4A_A2UI_CATALOG_ADAPTER)).not.toThrow();
  });
});
