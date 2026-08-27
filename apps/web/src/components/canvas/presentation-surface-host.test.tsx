// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { planGenericPresentationSurface } from '@/render/presentation/generic';
import { renderCatalogJson } from '@/render/registry';

import { CanvasBody } from '../canvas-body';
import { EntityCacheProvider } from '../entity-cache-provider';
import { PresentationSurfaceHost } from './presentation-surface-host';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/canvas');
});

const EMPTY_SPECS: SirenEntity = {
  class: ['collection', 'render-specs'],
  properties: { rel: 'render-specs', count: 0 },
  actions: [],
  links: [],
  entities: [],
};

function sourceEntity(rel: string, title: string): SirenEntity {
  return {
    class: ['work-item'],
    properties: {
      rel,
      title,
      status: 'open',
      presentation: {
        fields: [
          { path: 'properties.title', title: '标题', role: 'identity' },
          { path: 'properties.status', title: '状态', role: 'status' },
        ],
      },
    },
    actions: [
      {
        name: 'complete',
        title: '完成',
        method: 'POST',
        href: '/api/exec',
        fields: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ],
    'guard-results': [{ action: 'complete', blocked: false, guards: [] }],
    links: [],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface ContractFixture {
  fetchMock: ReturnType<typeof vi.fn>;
  sidecarId: string;
}

function presentationContract(input: {
  subject: string;
  source: SirenEntity;
  scope?: string;
  failSidecar?: boolean;
}): ContractFixture {
  const sidecarId = `sidecar:${encodeURIComponent(input.subject)}`;
  const sourceRel = String(input.source.properties.rel);
  const surface = planGenericPresentationSurface(
    sourceRel,
    input.source,
    'definition-v1',
    'read',
  ).surface;
  const fetchMock = vi.fn((request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    if (url === '/api/render/catalog')
      return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    if (url.startsWith('/.well-known/ui4a.json')) {
      if (input.scope !== undefined) {
        expect(new URL(url, 'http://ui4a.test').searchParams.get('scope')).toBe(input.scope);
      }
      return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
    }
    const presentationUrl =
      input.scope === undefined
        ? '/api/presentation'
        : `/api/presentation?scope=${encodeURIComponent(input.scope)}`;
    if (url === presentationUrl && init?.method === 'POST')
      return Promise.resolve(jsonResponse(200, { sidecar: { id: sidecarId } }));
    const execUrl =
      input.scope === undefined
        ? '/api/exec'
        : `/api/exec?scope=${encodeURIComponent(input.scope)}`;
    if (url === execUrl && init?.method === 'POST') {
      return Promise.resolve(jsonResponse(200, { entity: input.source }));
    }
    if (url.startsWith('/api/presentation/sidecar?')) {
      if (input.scope !== undefined) {
        expect(new URL(url, 'http://ui4a.test').searchParams.get('scope')).toBe(input.scope);
      }
      if (input.failSidecar) return Promise.resolve(jsonResponse(503, { error: 'offline' }));
      return Promise.resolve(
        jsonResponse(200, {
          sidecar: {
            id: sidecarId,
            version: 1,
            retention: 'cache',
            key: { subject: input.subject },
            surface,
            dependencies: [{ kind: 'entity-contract', ref: sourceRel }],
            view: { collapsedNodeIds: [], densityByNodeId: {} },
          },
        }),
      );
    }
    if (url.startsWith('/api/entity?rel=')) {
      if (input.scope !== undefined) {
        expect(new URL(url, 'http://ui4a.test').searchParams.get('scope')).toBe(input.scope);
      }
      const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel');
      if (rel === 'render-specs') return Promise.resolve(jsonResponse(200, EMPTY_SPECS));
      if (rel === sourceRel) return Promise.resolve(jsonResponse(200, input.source));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    }
    return Promise.resolve(jsonResponse(404, { error: `unknown ${url}` }));
  });
  return { fetchMock, sidecarId };
}

type MountCase = {
  name: string;
  subject: string;
  title: string;
  scope?: string;
  mount: () => React.ReactElement;
};

const cases: MountCase[] = [
  {
    name: 'Canvas URL 参数',
    subject: 'post:canvas',
    title: '画布对象',
    scope: 'publishing',
    mount: () => {
      window.history.pushState({}, '', '/canvas?focus=post%3Acanvas&scope=publishing');
      return <CanvasBody />;
    },
  },
  {
    name: '固定 workspace subject',
    subject: 'workspace:my-work',
    title: '我的事源',
    mount: () => (
      <PresentationSurfaceHost heading="我的事" parameters={{ focus: 'workspace:my-work' }} />
    ),
  },
];

describe('PresentationSurfaceHost 共享单树宿主', () => {
  it('Surface 动作组在同一 scope fresh-read 后才提交', async () => {
    window.history.pushState({}, '', '/canvas?focus=post%3Acanvas&scope=publishing');
    const source = sourceEntity('post:canvas', '画布对象');
    const fixture = presentationContract({ subject: 'post:canvas', source, scope: 'publishing' });
    vi.stubGlobal('fetch', fixture.fetchMock);

    render(
      <EntityCacheProvider scope="publishing">
        <CanvasBody />
      </EntityCacheProvider>,
    );
    expect(await screen.findByText('你和助手使用同一合同，由同一规则裁决')).toBeTruthy();
    const before = fixture.fetchMock.mock.calls.filter(([request]) =>
      String(request).startsWith('/api/entity?rel=post%3Acanvas'),
    ).length;

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() =>
      expect(
        fixture.fetchMock.mock.calls.filter(
          ([request, init]) =>
            String(request) === '/api/exec?scope=publishing' && init?.method === 'POST',
        ),
      ).toHaveLength(1),
    );
    const after = fixture.fetchMock.mock.calls.filter(([request]) =>
      String(request).startsWith('/api/entity?rel=post%3Acanvas'),
    ).length;
    // T35 F-01:提交前 fresh-read(+1);exec 成功后 executed 协议失效重取(再 +1)。
    expect(after).toBe(before + 2);
  });

  it('Surface 动作组可见呈现当前合同 guard reason', async () => {
    const source = sourceEntity('post:blocked', '受阻对象');
    source['guard-results'] = [
      {
        action: 'complete',
        blocked: true,
        reason: 'guard 不满足: item-ready=false',
        guards: [{ name: 'item-ready', pass: false }],
      },
    ];
    const fixture = presentationContract({ subject: 'post:blocked', source });
    vi.stubGlobal('fetch', fixture.fetchMock);

    render(
      <EntityCacheProvider>
        <PresentationSurfaceHost heading="共同注视" parameters={{ focus: 'post:blocked' }} />
      </EntityCacheProvider>,
    );

    expect((await screen.findByRole('status')).textContent).toBe('guard 不满足: item-ready=false');
    expect((screen.getByRole('button', { name: '完成' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Surface 动作组 executed 后精确失效并整面 reload(T35 F-01)', async () => {
    window.history.pushState({}, '', '/canvas?focus=post%3Acanvas&scope=publishing');
    const source = sourceEntity('post:canvas', '画布对象');
    const fixture = presentationContract({ subject: 'post:canvas', source, scope: 'publishing' });
    vi.stubGlobal('fetch', fixture.fetchMock);

    render(
      <EntityCacheProvider scope="publishing">
        <CanvasBody />
      </EntityCacheProvider>,
    );
    expect(await screen.findByText('你和助手使用同一合同，由同一规则裁决')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    // executed 协议与 A2UI 原生动作同口径:exec 成功 → 精确失效 + 整面 reload
    // (第二次 presentation 规划),实体经失效重取——投影当场活过来,零静默。
    await waitFor(() =>
      expect(
        fixture.fetchMock.mock.calls.filter(
          ([request, init]) =>
            String(request) === '/api/presentation?scope=publishing' && init?.method === 'POST',
        ),
      ).toHaveLength(2),
    );
    const entityFetches = fixture.fetchMock.mock.calls.filter(([request]) =>
      String(request).startsWith('/api/entity?rel=post%3Acanvas'),
    ).length;
    // 初次 hydrate(1) + adapter fresh-read(2) + 失效后重取(3)。
    expect(entityFetches).toBe(3);
  });

  it('focus 不可解析时呈现结构化空态:中性措辞 + 恢复出口,机制细节只进抽屉(T35 F-02)', async () => {
    window.history.pushState({}, '', '/canvas?focus=post%3Amissing');
    const source = sourceEntity('post:missing', '失踪对象');
    const fixture = presentationContract({ subject: 'post:missing', source });
    const inner = fixture.fetchMock.getMockImplementation()!;
    fixture.fetchMock.mockImplementation((request: RequestInfo | URL, init?: RequestInit) => {
      if (String(request).startsWith('/api/entity?rel=post%3Amissing')) {
        return Promise.resolve(jsonResponse(404, { error: '实体 "post:missing" 不存在' }));
      }
      return inner(request, init);
    });
    vi.stubGlobal('fetch', fixture.fetchMock);

    render(
      <EntityCacheProvider>
        <PresentationSurfaceHost heading="共同注视" parameters={{ focus: 'post:missing' }} />
      </EntityCacheProvider>,
    );

    const empty = await screen.findByTestId('canvas-focus-unavailable');
    // D51 中性口径:存在性隐藏,首屏不区分"不存在"与"不可见",不带裸 rel。
    expect(empty.textContent).toContain('内容不存在或不可见');
    expect(empty.textContent).not.toContain('post:missing');
    const home = screen.getByRole('link', { name: '返回首页' });
    expect(home.getAttribute('href')).toBe('/');
    // 机制细节(实体名/原始报错)只进 why 抽屉诊断。
    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
    expect(screen.getByTestId('canvas-why-diagnostics').textContent).toContain('post:missing');
    // 同文错误行不堆叠:errors 列表不再重复渲染同一句。
    expect(screen.queryAllByText('部分内容暂时无法显示，详情见「为什么这样展示」')).toHaveLength(0);
  });

  it.each(cases)(
    '$name 走 presentation → sidecar → hydrate → action gate → 单树链',
    async (testCase) => {
      const source = sourceEntity(
        testCase.subject === 'workspace:my-work' ? 'inbox' : testCase.subject,
        testCase.title,
      );
      const fixture = presentationContract({
        subject: testCase.subject,
        source,
        scope: testCase.scope,
      });
      vi.stubGlobal('fetch', fixture.fetchMock);

      const { container } = render(<EntityCacheProvider>{testCase.mount()}</EntityCacheProvider>);

      expect(await screen.findByRole('heading', { name: testCase.title, level: 1 })).toBeTruthy();
      expect(container.querySelectorAll('[data-surface]')).toHaveLength(1);
      expect(container.querySelector('[data-action="complete"]')).not.toBeNull();
      expect(screen.getByRole('button', { name: '为什么这样展示' })).toBeTruthy();

      const urls = fixture.fetchMock.mock.calls.map(([request]) => String(request));
      const presentationUrl =
        testCase.scope === undefined
          ? '/api/presentation'
          : `/api/presentation?scope=${encodeURIComponent(testCase.scope)}`;
      const presentationIndex = urls.indexOf(presentationUrl);
      const sidecarIndex = urls.findIndex((url) => url.startsWith('/api/presentation/sidecar?'));
      const hydrateSourceIndex = urls.findIndex((url) =>
        url.includes(`rel=${encodeURIComponent(String(source.properties.rel))}`),
      );
      expect(presentationIndex).toBeGreaterThan(-1);
      expect(sidecarIndex).toBeGreaterThan(presentationIndex);
      expect(hydrateSourceIndex).toBeGreaterThan(sidecarIndex);

      const [, presentationInit] = fixture.fetchMock.mock.calls[presentationIndex]!;
      expect(JSON.parse(String(presentationInit?.body))).toEqual({
        schemaVersion: 1,
        requestId: expect.any(String),
        principal: 'local-user',
        subject: testCase.subject,
        intent: 'read',
        delivery: 'canvas',
        sourceMessageIds: [],
      });

      fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
      await waitFor(() =>
        expect(
          fixture.fetchMock.mock.calls.filter(([request]) => String(request) === presentationUrl),
        ).toHaveLength(2),
      );
      expect(container.querySelectorAll('[data-surface]')).toHaveLength(1);
    },
  );

  it.each(cases)('$name 共享 sidecar 错误、why 与重载语义', async (testCase) => {
    const source = sourceEntity(
      testCase.subject === 'workspace:my-work' ? 'inbox' : testCase.subject,
      testCase.title,
    );
    const fixture = presentationContract({
      subject: testCase.subject,
      source,
      scope: testCase.scope,
      failSidecar: true,
    });
    vi.stubGlobal('fetch', fixture.fetchMock);

    render(<EntityCacheProvider>{testCase.mount()}</EntityCacheProvider>);

    // T32 Q5 迁移:首屏固定人话,机制细节(sidecar id/HTTP)只进 why 抽屉。
    const errors = await screen.findByTestId('canvas-errors');
    expect(errors.textContent).toBe('画布内容暂时无法载入，请稍后重试');
    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
    expect(screen.getByTestId('canvas-why-diagnostics').textContent).toContain(
      `Sidecar ${fixture.sidecarId} → HTTP 503`,
    );
    expect(screen.getByRole('button', { name: '重新载入' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
    await waitFor(() =>
      expect(
        fixture.fetchMock.mock.calls.filter(([request]) => {
          const expected =
            testCase.scope === undefined
              ? '/api/presentation'
              : `/api/presentation?scope=${encodeURIComponent(testCase.scope)}`;
          return String(request) === expected;
        }),
      ).toHaveLength(2),
    );
  });
});

describe('canvas 载入失败呈现(T32 Q5:首屏零机制标识,细节进 why 抽屉)', () => {
  it('sidecar 载入失败:主区域只显示固定人话,HTTP 状态/sidecar id 不上首屏,细节在抽屉可达', async () => {
    window.history.pushState({}, '', '/canvas?focus=post%3Afail');
    const source = sourceEntity('post:fail', '失败对象');
    const fixture = presentationContract({
      subject: 'post:fail',
      source,
      failSidecar: true,
    });
    vi.stubGlobal('fetch', fixture.fetchMock);

    render(
      <EntityCacheProvider>
        <CanvasBody />
      </EntityCacheProvider>,
    );

    const errors = await screen.findByTestId('canvas-errors');
    const text = errors.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
    // 首屏固定人话(D47 第 5 问口径):不携带 URL、HTTP 状态、sidecar id。
    expect(text).not.toContain('HTTP');
    expect(text).not.toContain(fixture.sidecarId);
    expect(text).not.toContain('/api/');

    // 机制细节保留在 why 抽屉(审计可达,不静默)。
    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
    const diagnostics = await screen.findByTestId('canvas-why-diagnostics');
    const detail = diagnostics.textContent ?? '';
    expect(detail).toContain('HTTP 503');
    expect(detail).toContain(fixture.sidecarId);
  });

  it('sidecar 结构化 denied(403):首屏「部分内容」人话,reasonCode 只进 why 抽屉(D51/B4)', async () => {
    window.history.pushState({}, '', '/canvas?focus=post%3Adenied');
    const source = sourceEntity('post:denied', '越界对象');
    const sidecarId = 'sidecar:denied';
    const fetchMock = vi.fn((request: RequestInfo | URL) => {
      const url = String(request);
      if (url === '/api/render/catalog') {
        return Promise.resolve(jsonResponse(200, renderCatalogJson()));
      }
      if (url.startsWith('/.well-known/ui4a.json')) {
        return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
      }
      if (url === '/api/presentation' || url.startsWith('/api/presentation/sidecar?')) {
        if (url === '/api/presentation') {
          return Promise.resolve(jsonResponse(200, { sidecar: { id: sidecarId } }));
        }
        return Promise.resolve(
          jsonResponse(403, {
            error: { code: 'sidecar-denied', detail: 'grants-shrunk' },
          }),
        );
      }
      if (url.startsWith('/api/entity?rel=')) {
        const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel');
        return Promise.resolve(
          rel === 'render-specs'
            ? jsonResponse(200, EMPTY_SPECS)
            : jsonResponse(200, rel === 'post:denied' ? source : { error: 'not found' }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: `unknown ${url}` }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <EntityCacheProvider>
        <PresentationSurfaceHost heading="共同注视" parameters={{ focus: 'post:denied' }} />
      </EntityCacheProvider>,
    );

    // 首屏诚实人话:denied ≠ 内容不存在,也 ≠ 画布整体失败。
    const errors = await screen.findByTestId('canvas-errors');
    expect(errors.textContent).toBe('部分内容暂时无法显示，详情见「为什么这样展示」');
    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
    const diagnostics = await screen.findByTestId('canvas-why-diagnostics');
    const detail = diagnostics.textContent ?? '';
    expect(detail).toContain('grants-shrunk');
    expect(detail).toContain(sidecarId);

    // fetch 全程未发送任何机制词到主区域(surface 未挂载)。
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sidecar unknown(404):首屏「内容不存在或不可见」,机制细节进抽屉', async () => {
    window.history.pushState({}, '', '/canvas?focus=post%3Agone');
    const source = sourceEntity('post:gone', '消失对象');
    const sidecarId = 'sidecar:gone';
    const fetchMock = vi.fn((request: RequestInfo | URL) => {
      const url = String(request);
      if (url === '/api/render/catalog') {
        return Promise.resolve(jsonResponse(200, renderCatalogJson()));
      }
      if (url.startsWith('/.well-known/ui4a.json')) {
        return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
      }
      if (url === '/api/presentation' || url.startsWith('/api/presentation/sidecar?')) {
        if (url === '/api/presentation') {
          return Promise.resolve(jsonResponse(200, { sidecar: { id: sidecarId } }));
        }
        return Promise.resolve(jsonResponse(404, { error: 'Sidecar not found' }));
      }
      if (url.startsWith('/api/entity?rel=')) {
        const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel');
        return Promise.resolve(
          rel === 'render-specs'
            ? jsonResponse(200, EMPTY_SPECS)
            : jsonResponse(200, rel === 'post:gone' ? source : { error: 'not found' }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: `unknown ${url}` }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <EntityCacheProvider>
        <PresentationSurfaceHost heading="共同注视" parameters={{ focus: 'post:gone' }} />
      </EntityCacheProvider>,
    );

    const errors = await screen.findByTestId('canvas-errors');
    expect(errors.textContent).toBe('内容不存在或不可见');
    expect(errors.textContent).not.toContain(sidecarId);
    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
    const diagnostics = await screen.findByTestId('canvas-why-diagnostics');
    expect(diagnostics.textContent ?? '').toContain(`Sidecar ${sidecarId} → HTTP 404`);
  });
});
