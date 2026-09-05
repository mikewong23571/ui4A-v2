// @vitest-environment jsdom
/**
 * T56 P0.3 / S2 探针(临时):引用时点诚实 —— CitationList 组件层实证。
 *
 * 覆盖探针步骤 3/4:集合成员 pointer 引用现在解析到什么、改名后标题显示、
 * 授权撤回后的失败表现、标题获取有无缓存与失效机制。
 * 结论回填 probes/s2-history-citations.md;P3 定案后删除或改写为正式测试。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { CitationList } from './citation-list';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function entityResponse(properties: Record<string, unknown>): Response {
  return Response.json({ class: ['entity'], properties, links: [], actions: [] }, { status: 200 });
}

describe('S2 步骤3:集合成员 pointer 引用的组件解析', () => {
  it('pointer=/entities/1/... 不参与定位:标签=集合当前标题,点击落到集合,无时点/成员标注', async () => {
    window.history.replaceState({}, '', `/canvas?thread=${'t56s2-thread-a'}`);
    const fetchMock = vi.fn(async () =>
      entityResponse({
        rel: 'ideas:t56s2',
        identity: 'T56S2 想法清单(今天的成员顺序)',
        count: 3,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CitationList citations={[{ rel: 'ideas:t56s2', pointer: '/entities/1/properties/rel' }]} />,
    );

    await waitFor(() => expect(screen.getByText(/T56S2 想法清单/)).toBeTruthy());
    const link = screen.getByRole('link');
    // 集合级:标签是集合(今天)的声明身份;pointer 只进审计 title。
    expect(link.getAttribute('data-rel')).toBe('ideas:t56s2');
    expect(link.getAttribute('data-pointer')).toBe('/entities/1/properties/rel');
    expect(link.getAttribute('href')).toBe('/canvas?focus=ideas%3At56s2&thread=t56s2-thread-a');
    expect(link.getAttribute('title')).toContain('/entities/1/properties/rel');
    // 无任何「回答时依据/当前内容」时点边界标注(FR8 要求的降级信息目前缺席)。
    expect(screen.queryByText(/回答时/)).toBeNull();
    expect(screen.queryByText(/当时/)).toBeNull();
    // 用户无法从 chip 外观区分「集合级来源」与「精确定位对象」。
    expect(link.getAttribute('data-nav')).toBe('citation:ideas:t56s2');
  });

  it('集合级引用与单对象引用的 chip 结构完全相同(无类型区分)', async () => {
    window.history.replaceState({}, '', '/canvas');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const rel = String(input).includes('idea%3At56s2-x') ? 'idea:t56s2-x' : 'ideas:t56s2';
      return entityResponse(
        rel === 'idea:t56s2-x'
          ? { rel: 'idea:t56s2-x', identity: '单个想法 X' }
          : { rel: 'ideas:t56s2', identity: '想法集合' },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CitationList
        citations={[
          { rel: 'idea:t56s2-x', pointer: '/' },
          { rel: 'ideas:t56s2', pointer: '/entities/1/properties/rel' },
        ]}
      />,
    );
    await waitFor(() => expect(screen.getByText('单个想法 X')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('想法集合')).toBeTruthy());
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    // 两种 chip 的可见结构相同:标签 + rel 对照;唯一差异是审计 title 的 pointer。
    expect(links[0]!.getAttribute('title')).toBe('idea:t56s2-x · /(JSON Pointer,审计口径)');
    expect(links[1]!.getAttribute('title')).toContain('/entities/1/properties/rel');
  });
});

describe('S2 步骤4:改名 / 授权撤回 / 标题获取缓存', () => {
  it('目标改名后:历史回合显示当前名,无时点标注,也无任何途径知道回答时名称', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => entityResponse({ rel: 'idea:t56s2-r', identity: '改名后的新标题' })),
    );
    render(<CitationList citations={[{ rel: 'idea:t56s2-r', pointer: '/properties/identity' }]} />);
    await waitFor(() => expect(screen.getByText('改名后的新标题')).toBeTruthy());
    // FactRef 无快照/版本 → 回答时名称不可知;UI 也未标注「当前名称」(FR8 缺口)。
    expect(screen.queryByText(/回答时/)).toBeNull();
    expect(screen.queryByText(/当时标题/)).toBeNull();
    const link = screen.getByRole('link');
    expect(link.getAttribute('title')).not.toContain('旧标题');
  });

  it('授权撤回(403):诚实回退 rel 本身,不猜名称、不显示存在性', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'denied' }), { status: 403 })),
    );
    render(
      <CitationList citations={[{ rel: 'idea:t56s2-revoked', pointer: '/properties/identity' }]} />,
    );
    await waitFor(() =>
      expect(screen.getAllByText('idea:t56s2-revoked').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/t56s2 存在的任何名称/)).toBeNull();
    // 点击仍会导航到该 rel(点进去将得到 denied 回执,引用本身不隐藏原 rel)。
    expect(screen.getByRole('link').getAttribute('href')).toContain(
      `focus=${encodeURIComponent('idea:t56s2-revoked')}`,
    );
  });

  it('网络失败:同样回退 rel,citation 读取失败不炸整条消息', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    render(<CitationList citations={[{ rel: 'idea:t56s2-net', pointer: '/' }]} />);
    await waitFor(() => expect(screen.getAllByText('idea:t56s2-net').length).toBeGreaterThan(0));
  });

  it('标题获取现状:无跨实例缓存 —— 每次挂载都重新 fetch(cache: no-store)', async () => {
    window.history.replaceState({}, '', '/canvas');
    const fetchMock = vi.fn(async (_url: string | URL | RequestInfo) =>
      entityResponse({ rel: 'idea:t56s2-c', identity: '缓存探针标题' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const citations = [{ rel: 'idea:t56s2-c', pointer: '/properties/identity' }];

    const { unmount } = render(<CitationList citations={citations} />);
    await waitFor(() => expect(screen.getByText('缓存探针标题')).toBeTruthy());
    unmount();
    cleanup();

    render(<CitationList citations={citations} />);
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    // 两次挂载各自发起了 /api/entity 读取:无模块级缓存、无失效机制 ——
    // 标签永远重读当前值(新鲜但无时点),也没有「撤回后保留旧标签」的缓存问题。
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes('/api/entity'))).toBe(
      true,
    );
  });
});
