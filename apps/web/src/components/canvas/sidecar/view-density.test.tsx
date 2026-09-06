// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { SirenEntity } from '@ui4a/engine';

import { planGenericPresentationSurface } from '@/render/presentation/generic';
import { renderCatalogJson } from '@/render/registry';
import { EntityCacheProvider } from '../../entity-cache-provider';
import { PresentationSurfaceHost } from '../presentation-surface-host';
import { usePresentationSurfaceLoad } from '../use-presentation-surface-load';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fixture(initialDensity: 'compact' | 'spacious') {
  const source: SirenEntity = {
    class: ['record'],
    properties: {
      rel: 'record:one',
      title: 'One',
      presentation: {
        fields: [{ path: 'properties.title', title: 'Title', role: 'identity' }],
      },
    },
    actions: [],
    links: [],
  };
  const surface = planGenericPresentationSurface('record:one', source, 'v1', 'read').surface;
  const rootId = surface.root.id;
  if (surface.root.kind !== 'layout') throw new Error('generic fixture must have a layout root');
  const childId = surface.root.children[0]!.id;
  const saved = { version: 1, density: initialDensity };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/render/catalog') return Response.json(renderCatalogJson());
    if (url.startsWith('/.well-known/ui4a.json')) return Response.json({ version: 'v1' });
    if (url.startsWith('/api/presentation/sidecar?'))
      return Response.json({
        sidecar: {
          id: 'sidecar:one',
          version: saved.version,
          retention: 'cache',
          key: { subject: 'record:one' },
          surface,
          dependencies: [{ kind: 'entity-contract', ref: 'record:one' }],
          view: {
            collapsedNodeIds: [childId],
            densityByNodeId: { [rootId]: saved.density, [childId]: 'compact' },
          },
        },
      });
    if (url.includes('rel=render-specs'))
      return Response.json({
        class: ['collection'],
        properties: {},
        actions: [],
        links: [],
        entities: [],
      });
    if (url.includes('rel=record%3Aone')) return Response.json(source);
    return Response.json({ error: 'unexpected path' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  return { saved, rootId, childId };
}

function Wrapper({ children }: { children: ReactNode }) {
  return <EntityCacheProvider>{children}</EntityCacheProvider>;
}

it.each(['compact', 'spacious'] as const)(
  'maps persisted root %s density on GET and a new Sidecar version, preserving non-root preferences',
  async (initial) => {
    const { saved, rootId, childId } = fixture(initial);
    const { result } = renderHook(
      () => usePresentationSurfaceLoad({ focus: 'record:one', sidecar: 'sidecar:one' }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors).toEqual([]);
    expect(result.current.surfaces).toHaveLength(1);
    const first = result.current.sidecarMeta!;
    expect(first.rootNodeId).toBe(`${rootId}-v1`);
    expect(first.view.densityByNodeId[first.rootNodeId]).toBe(initial);
    expect(first.view.densityByNodeId[childId]).toBe('compact');
    expect(first.view.collapsedNodeIds).toEqual([childId]);
    expect(first.view.densityByNodeId).not.toHaveProperty(rootId);
    saved.version = 2;
    saved.density = initial === 'compact' ? 'spacious' : 'compact';
    await act(() => result.current.load());
    const reloaded = result.current.sidecarMeta!;
    expect(reloaded.rootNodeId).toBe(`${rootId}-v2`);
    expect(reloaded.view.densityByNodeId[reloaded.rootNodeId]).toBe(saved.density);
    expect(reloaded.view.densityByNodeId[childId]).toBe('compact');
    expect(reloaded.view.densityByNodeId).not.toHaveProperty(`${rootId}-v1`);
  },
);

it('the real Surface host consumes compact then spacious root padding after reload', async () => {
  const { saved } = fixture('compact');
  const view = render(
    <Wrapper>
      <PresentationSurfaceHost parameters={{ focus: 'record:one', sidecar: 'sidecar:one' }} />
    </Wrapper>,
  );
  await waitFor(() =>
    expect(view.container.querySelector('[data-surface]')?.classList.contains('p-2')).toBe(true),
  );
  saved.version = 2;
  saved.density = 'spacious';
  fireEvent.click(screen.getByRole('button', { name: '页面工具' }));
  fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
  await waitFor(() =>
    expect(view.container.querySelector('[data-surface]')?.classList.contains('p-8')).toBe(true),
  );
  expect(view.container.querySelector('[data-surface]')?.classList.contains('p-2')).toBe(false);
});
