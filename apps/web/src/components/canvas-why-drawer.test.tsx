// @vitest-environment jsdom
/**
 * 「为什么这样展示」抽屉测试(T24 Phase A Task 3,Red 先行)。
 *
 * 口径:
 * - 默认关闭:入口按钮 aria-expanded=false;抽屉关闭时零机制词
 *   (lib/mechanism-words 固定清单,与 canvas-first-screen.test 同表);
 * - 打开后:surface ID/目录协商、sidecar 元数据、嵌入控制条全部操作按钮;
 * - 能力等价:抽屉内 pin/patch/promote(预览+确认)/explain 经真实
 *   useSidecarActions 触发,fetch 请求形状(方法/URL/body 字段)与现状
 *   主区域控制条完全一致(对照 use-sidecar-actions 实现与
 *   app/api/presentation/sidecar/route.test.ts 的合同);
 * - explain 结果(provenance kind/ref、依赖数)结构化渲染在抽屉内,
 *   notify 告示现状保留;
 * - 原始合同 JSON 区块如实展示传入的只读文本。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';

import { MECHANISM_WORDS } from '@/lib/mechanism-words';
import { renderCatalogJson } from '@/render/registry';

import { CanvasWhyDrawer } from './canvas-why-drawer';
import type { SidecarMeta } from './use-sidecar-actions';
import { useSidecarActions } from './use-sidecar-actions';

const CATALOG_ID = renderCatalogJson().catalogId;
const SURFACE_IDS = ['presentation-post%3Afirst-post'];
const RAW_JSON = JSON.stringify({
  class: ['flow-instance'],
  properties: { rel: 'post:first-post' },
});
const SIDECAR_META: SidecarMeta = {
  id: 'sidecar:1',
  version: 2,
  retention: 'cache',
  rootNodeId: 'root',
  view: { collapsedNodeIds: [], densityByNodeId: {} },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sidecarResponseBody(version: number, retention: 'cache' | 'pinned'): unknown {
  return {
    sidecar: {
      id: 'sidecar:1',
      version,
      retention,
      rootNodeId: 'root',
      view: { collapsedNodeIds: [], densityByNodeId: {} },
    },
  };
}

type FetchMock = ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;

/** 方法/URL/头/body 字段与现状控制条(use-sidecar-actions)逐项对照。 */
function expectRequest(
  mock: FetchMock,
  index: number,
  expectedBody: Record<string, unknown>,
): void {
  const [input, init] = mock.mock.calls[index]!;
  expect(input).toBe('/api/presentation/sidecar');
  expect(init?.method).toBe('POST');
  expect(init?.headers).toEqual({ 'content-type': 'application/json' });
  expect(JSON.parse(String(init?.body))).toEqual(expectedBody);
}

/** 静态 props 直渲(不依赖 hook):默认关闭/打开信息/空态断言用。 */
function renderDrawer(overrides: Partial<Parameters<typeof CanvasWhyDrawer>[0]> = {}) {
  const props: Parameters<typeof CanvasWhyDrawer>[0] = {
    surfaceIds: SURFACE_IDS,
    catalogId: CATALOG_ID,
    focusEntityJson: RAW_JSON,
    sidecarMeta: SIDECAR_META,
    promotionPending: false,
    explanation: undefined,
    mutateSidecar: vi.fn(),
    patchSidecar: vi.fn(),
    explainSidecar: vi.fn(),
    promoteSidecar: vi.fn(),
    cancelPromotion: vi.fn(),
    ...overrides,
  };
  return render(<CanvasWhyDrawer {...props} />);
}

/** 真实 useSidecarActions 包裹 + 打开抽屉:能力等价断言走真实调用链。 */
async function renderOpenHarness(): Promise<void> {
  function DrawerHarness() {
    const [notice, setNotice] = useState<string | null>(null);
    const actions = useSidecarActions({ notify: setNotice, reload: () => undefined });
    const { setSidecarMeta } = actions;
    useEffect(() => {
      setSidecarMeta(SIDECAR_META);
    }, [setSidecarMeta]);
    return (
      <div>
        {notice !== null && <p data-testid="harness-notice">{notice}</p>}
        <CanvasWhyDrawer
          surfaceIds={SURFACE_IDS}
          catalogId={CATALOG_ID}
          focusEntityJson={RAW_JSON}
          sidecarMeta={actions.sidecarMeta}
          promotionPending={actions.promotionPending}
          explanation={actions.explanation}
          mutateSidecar={actions.mutateSidecar}
          patchSidecar={actions.patchSidecar}
          explainSidecar={actions.explainSidecar}
          promoteSidecar={actions.promoteSidecar}
          cancelPromotion={() => actions.setPromotionPending(false)}
        />
      </div>
    );
  }
  render(<DrawerHarness />);
  fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
  await screen.findByRole('button', { name: '以后都这样看' });
}

describe('「为什么这样展示」抽屉(T24)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('默认关闭:入口按钮 aria-expanded=false;关闭时零机制词;打开/关闭可达', () => {
    const { container } = renderDrawer();

    const entry = screen.getByRole('button', { name: '为什么这样展示' });
    expect(entry.getAttribute('data-nav')).toBe('local:canvas-why');
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(entry.getAttribute('aria-controls')).toBe('canvas-why-drawer-panel');
    expect(screen.queryByTestId('canvas-why-drawer')).toBeNull();

    // 关闭时:机制信息(surface ID/目录/个人呈现)零泄漏(首屏同表口径)。
    const text = container.textContent ?? '';
    expect(MECHANISM_WORDS.filter((word) => text.includes(word))).toEqual([]);

    fireEvent.click(entry);
    expect(entry.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('canvas-why-drawer')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('canvas-why-drawer')).toBeNull();
  });

  it('打开后:surface/目录信息、sidecar 元数据与嵌入控制条全部操作按钮', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));

    // a. surface 与目录信息(机制词只出现在抽屉内)。
    expect(screen.getByTestId('canvas-why-catalog').textContent).toContain(CATALOG_ID);
    expect(screen.getByTestId('canvas-why-surfaces').textContent).toContain(
      'presentation-post%3Afirst-post',
    );

    // b. sidecar 元数据(个人呈现 · v… · 缓存)+ 嵌入控制条按条件渲染的全部
    // 操作按钮(retention=cache → pin 可见;version>1 → revert 可见)。
    expect(screen.getByText(/个人呈现 · v2 · 缓存/)).toBeTruthy();
    for (const name of ['以后都这样看', '恢复上一版本', '收起视图', '切换疏密', '设为团队默认']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    // 嵌入控制条的 explain 按钮(「为什么这样展示」= 入口 + 控制条各一)。
    expect(screen.queryAllByRole('button', { name: '为什么这样展示' })).toHaveLength(2);

    // d. 原始合同 JSON:如实展示传入文本。
    expect(screen.getByTestId('canvas-why-raw-json').textContent).toContain('post:first-post');
  });

  it('无 sidecar/无 focus 实体时:抽屉内呈现空态而非机制残影', () => {
    renderDrawer({
      surfaceIds: [],
      catalogId: undefined,
      focusEntityJson: undefined,
      sidecarMeta: undefined,
    });
    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
    expect(screen.getByText(/没有 Sidecar 个人呈现/)).toBeTruthy();
    expect(screen.getByText(/没有 focus 实体/)).toBeTruthy();
    expect(screen.getByText(/没有渲染中的 surface/)).toBeTruthy();
  });

  it('能力等价:抽屉内 pin/patch 触发与现状控制条一致的请求形状', async () => {
    const fetchMock = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, sidecarResponseBody(3, 'pinned'))),
      );
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenHarness();

    // pin:POST /api/presentation/sidecar,body 与 use-sidecar-actions 逐字段一致。
    fireEvent.click(screen.getByRole('button', { name: '以后都这样看' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectRequest(fetchMock, 0, { sidecarId: 'sidecar:1', action: 'pin', actor: 'human' });

    // patch(collapse):action/actor/interactionId 前缀/operations 与现状一致。
    fireEvent.click(screen.getByRole('button', { name: '收起视图' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectRequest(fetchMock, 1, {
      sidecarId: 'sidecar:1',
      action: 'patch',
      actor: 'human',
      interactionId: expect.stringMatching(/^canvas:collapse:/),
      operations: [{ kind: 'collapse', nodeId: 'root', collapsed: true }],
    });
  });

  it('能力等价:promote 预览 → 确认两段请求形状与现状一致', async () => {
    const fetchMock = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, {
            diff: { fromSidecarVersion: 2, parameterized: true },
            recipe: { id: 'recipe:1', version: 1 },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenHarness();

    fireEvent.click(screen.getByRole('button', { name: '设为团队默认' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectRequest(fetchMock, 0, {
      sidecarId: 'sidecar:1',
      action: 'promotion-preview',
      actor: 'human',
    });

    // 预览后进入确认态:确认/取消按钮出现(与主区域控制条现状一致)。
    fireEvent.click(await screen.findByRole('button', { name: '确认团队默认' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectRequest(fetchMock, 1, { sidecarId: 'sidecar:1', action: 'promote', actor: 'human' });
  });

  it('explain:结构化渲染 provenance kind/ref 与依赖数;notify 告示现状保留', async () => {
    const fetchMock = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, {
            explanation: {
              provenance: { kind: 'human-patch', ref: 'canvas:collapse:1' },
              dependencyIds: ['dep:1', 'dep:2', 'dep:3'],
            },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenHarness();

    fireEvent.click(screen.getByTestId('canvas-why-explain'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/presentation/sidecar?sidecarId=sidecar%3A1&explain=1',
    );

    expect(screen.getByTestId('canvas-why-provenance-kind').textContent).toBe('human-patch');
    expect(screen.getByTestId('canvas-why-provenance-ref').textContent).toBe('canvas:collapse:1');
    expect(screen.getByTestId('canvas-why-dependency-count').textContent).toBe('3 项');
    // notify 告示仍是现状口径(「这样展示是因为 …」)。
    expect(screen.getByTestId('harness-notice').textContent).toContain('这样展示是因为');
  });
});
