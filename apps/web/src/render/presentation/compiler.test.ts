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
          id: 'subject-region',
          role: 'primary-content',
          name: 'subject',
          dependencies: [],
          provenance,
          child: {
            kind: 'layout',
            id: 'subject-content',
            role: 'primary-content',
            layout: 'stack',
            dependencies: [],
            provenance,
            children: [
              {
                kind: 'word',
                id: 'heading',
                role: 'identity',
                word: 'heading',
                bindings: {
                  value: {
                    kind: 'property',
                    subject: 'post:first',
                    path: 'properties.fields.title',
                  },
                },
                dependencies: [
                  catalogDependency,
                  entityDependency('post:first', ['properties.fields.title']),
                ],
                provenance,
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
        },
      ],
    },
  };
}

function workspaceSurface(): SurfaceTree {
  const region = (
    name: string,
    child: Extract<SurfaceTree['root'], { kind: 'word' | 'diagnostic' }>,
  ) => ({
    kind: 'slot' as const,
    id: `region-slot:${name}`,
    role: 'primary-content' as const,
    name,
    dependencies: [],
    provenance: [
      { kind: 'composition-declaration' as const, ref: `composition:my-work@1#${name}` },
    ],
    child,
  });
  return {
    schemaVersion: 1,
    root: {
      kind: 'layout',
      id: 'root',
      role: 'primary-content',
      layout: 'stack',
      dependencies: [],
      provenance: [{ kind: 'composition-declaration', ref: 'composition:my-work@1' }],
      children: [
        region('waiting-for-me', {
          kind: 'word',
          id: 'waiting-state',
          role: 'status',
          word: 'state',
          bindings: {
            value: { kind: 'property', subject: 'inbox', path: 'properties.count' },
          },
          dependencies: [catalogDependency, entityDependency('inbox', ['properties.count'])],
          provenance,
        }),
        region('in-motion', {
          kind: 'diagnostic',
          id: 'moving-unavailable',
          role: 'diagnostic',
          code: 'region-unavailable',
          dependencies: [],
          provenance: [{ kind: 'validator', ref: 'region-unavailable' }],
        }),
        region('work-lines', {
          kind: 'word',
          id: 'thread-count',
          role: 'primary-content',
          word: 'prose',
          bindings: {
            value: { kind: 'property', subject: 'threads', path: 'properties.count' },
          },
          dependencies: [catalogDependency, entityDependency('threads', ['properties.count'])],
          provenance,
        }),
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
  ['property:inbox:properties.count', 2],
  ['property:threads:properties.count', 3],
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
  it('compiles one workspace root with three direct region slots through generic words and diagnostics', () => {
    const bundle = compileSurfaceTree(workspaceSurface(), {
      surfaceId: 'presentation-workspace%3Amy-work',
      catalog: PRESENTATION_SURFACE_CATALOG,
      catalogAdapter: UI4A_A2UI_CATALOG_ADAPTER,
      expectedCatalogFingerprint: UI4A_A2UI_CATALOG_ADAPTER.fingerprint,
      deref,
    });

    expect(bundle.issues).toEqual([]);
    expect(bundle.messages.filter((message) => 'createSurface' in message)).toHaveLength(1);
    const componentMessage = bundle.messages[2] as Extract<
      A2uiMessage,
      { updateComponents: unknown }
    >;
    const root = componentMessage.updateComponents.components.find(
      (component) => component.id === 'root',
    );
    expect(root).toMatchObject({ component: 'Column' });
    expect(root?.children).toEqual([
      'node:region-slot%3Awaiting-for-me',
      'node:region-slot%3Ain-motion',
      'node:region-slot%3Awork-lines',
    ]);
    expect(componentMessage.updateComponents.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'semantic-text', variant: 'status' }),
        expect.objectContaining({ component: 'semantic-text', variant: 'prose' }),
        expect.objectContaining({ id: 'node:moving-unavailable', variant: 'caption' }),
      ]),
    );
  });

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
        expect.objectContaining({ component: 'semantic-text', variant: 'heading' }),
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
    expect((item.snapshot as unknown as { value: unknown }).value).toEqual({
      path: 'properties/fields/title',
    });
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

    const literal = surface();
    if (literal.root.kind !== 'layout') throw new Error('fixture must be a layout');
    const subjectRegion = literal.root.children.find(
      (node) => node.kind === 'slot' && node.name === 'subject',
    );
    if (subjectRegion?.kind !== 'slot' || subjectRegion.child.kind !== 'layout') {
      throw new Error('fixture must contain the canonical subject region');
    }
    const heading = subjectRegion.child.children.find((node) => node.id === 'heading');
    if (heading?.kind !== 'word') throw new Error('fixture must contain a heading word');
    (heading.bindings as Record<string, unknown>).value = 'leaked literal';
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
