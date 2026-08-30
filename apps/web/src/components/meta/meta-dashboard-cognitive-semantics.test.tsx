// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MetaDashboard } from './meta-dashboard';
import { projectMetaSurfaceDescriptors, type MetaSitemapDocument } from './meta-surfaces';

interface CognitiveSurface {
  rel: string;
  title: string;
  collection: true;
  presentation: {
    version: 1;
    traits?: string[];
    groupRole: 'responsibility' | 'candidate' | 'definition' | 'system';
    priority: 'high' | 'normal' | 'low';
    fields?: {
      path: string;
      title: string;
      role: 'identity' | 'primary-content' | 'metadata';
      overview: true;
    }[];
  };
}

function cognitiveSurface(
  rel: string,
  title: string,
  groupRole: CognitiveSurface['presentation']['groupRole'],
  priority: CognitiveSurface['presentation']['priority'],
  options: Pick<CognitiveSurface['presentation'], 'traits' | 'fields'> = {},
): CognitiveSurface {
  return {
    rel,
    title,
    collection: true,
    presentation: { version: 1, groupRole, priority, ...options },
  };
}

function sitemap(version: string, surfaces: CognitiveSurface[]): MetaSitemapDocument {
  return {
    protocolVersion: '1',
    version,
    site: 'meta',
    effectiveScope: 'governance',
    authorizedScopes: ['governance'],
    authorizationMode: 'credential',
    surfaces,
  } as unknown as MetaSitemapDocument;
}

function stubContract(
  document: MetaSitemapDocument,
  summaries: Record<string, { count: number; intent: string; class?: string[] }>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('.well-known')) return new Response(JSON.stringify(document));
      const rel = new URL(url, 'http://ui4a.local').searchParams.get('rel') ?? '';
      const summary = summaries[rel] ?? { count: 0, intent: '' };
      const surface = (document.surfaces as unknown as CognitiveSurface[]).find(
        (candidate) => candidate.rel === rel,
      );
      return new Response(
        JSON.stringify({
          class: summary.class ?? ['collection', 'future-contract-surface'],
          properties: {
            rel,
            title: surface?.title ?? rel,
            intent: summary.intent,
            count: summary.count,
            presentation: surface?.presentation,
          },
          actions: [],
          links: [],
          entities: [],
          'guard-results': [],
        }),
      );
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Meta dashboard cognitive sitemap contract', () => {
  it('groups by declared cognition and admits an unknown future surface in declaration order', async () => {
    const futureFields: NonNullable<CognitiveSurface['presentation']['fields']> = [
      {
        path: 'properties.title',
        title: '名称',
        role: 'identity',
        overview: true,
      },
      {
        path: 'properties.intent',
        title: '用途',
        role: 'primary-content',
        overview: true,
      },
    ];
    const surfaces = [
      cognitiveSurface('meta/decisions', '需要处理的决定', 'responsibility', 'high', {
        traits: ['human-responsibility'],
      }),
      cognitiveSurface('meta/anomalies', '候选和异常', 'candidate', 'high'),
      cognitiveSurface('meta/future-nebulas', '未来星云定义', 'definition', 'normal', {
        fields: futureFields,
      }),
      cognitiveSurface('meta/known-assets', '现有定义资产', 'definition', 'normal'),
      cognitiveSurface('meta/bootstrap', '系统自举合同', 'system', 'low'),
    ];
    const document = sitemap('cognitive-v1', surfaces);
    stubContract(document, {
      'meta/decisions': { count: 2, intent: '决定是否激活候选' },
      'meta/anomalies': { count: 1, intent: '检查无效候选' },
      'meta/future-nebulas': {
        count: 3,
        intent: '管理未来才安装的定义资产',
        // Misleading class/status-like words must not reclassify this surface.
        class: ['collection', 'pending-approval', 'system-object', 'future-nebula'],
      },
      'meta/known-assets': { count: 4, intent: '管理当前定义' },
      'meta/bootstrap': { count: 1, intent: '审计系统语义' },
    });

    render(<MetaDashboard requestedScope="governance" />);
    await screen.findByTestId('meta-content-ready');

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['需要我决定', '候选与异常', '定义资产', '系统自举']);

    const definitionGroup = screen.getByRole('region', { name: '定义资产' });
    expect(
      within(definitionGroup)
        .getAllByTestId('meta-surface')
        .map((entry) => entry.textContent),
    ).toEqual([expect.stringContaining('未来星云定义'), expect.stringContaining('现有定义资产')]);
    expect(within(definitionGroup).getByText('管理未来才安装的定义资产')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: '候选与异常' })).queryByText('未来星云定义'),
    ).toBeNull();

    const projected = projectMetaSurfaceDescriptors(document).find(
      (descriptor) => descriptor.rel === 'meta/future-nebulas',
    ) as unknown as { presentation?: unknown };
    expect(projected.presentation).toEqual({
      version: 1,
      groupRole: 'definition',
      priority: 'normal',
      fields: futureFields,
    });
  });

  it('does not promote an empty responsibility collection to a large dashboard card', async () => {
    const document = sitemap('empty-responsibility-v1', [
      cognitiveSurface('meta/empty-decisions', '当前没有待决定项', 'responsibility', 'high', {
        traits: ['human-responsibility'],
      }),
      cognitiveSurface('meta/assets', '定义资产', 'definition', 'normal'),
    ]);
    stubContract(document, {
      'meta/empty-decisions': { count: 0, intent: '查看责任点入口' },
      'meta/assets': { count: 2, intent: '浏览定义资产' },
    });

    render(<MetaDashboard requestedScope="governance" />);
    await screen.findByTestId('meta-content-ready');

    expect(screen.queryByRole('region', { name: '需要我决定' })).toBeNull();
    expect(screen.queryByRole('link', { name: /当前没有待决定项/ })).toBeNull();

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '当前没有待决定项' },
    });
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('link', { name: /当前没有待决定项/ })
          .some(
            (link) =>
              link.getAttribute('href') ===
              '/meta/entity?rel=meta%2Fempty-decisions&scope=governance',
          ),
      ).toBe(true);
    });
  });
});
