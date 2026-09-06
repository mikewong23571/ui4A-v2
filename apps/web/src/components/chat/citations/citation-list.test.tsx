// @vitest-environment jsdom
/**
 * T56 P3.4 正式测试(US09/FR8;D78 决定 5):可辨引用。
 *
 * 承接并反转 S2 探针(citation-list.s2-probe.test.tsx)的「现状锚」断言:
 * - 集合/成员型引用必须显式呈现「集合级依据」+ 时点边界行,不冒充精确定位(A1/A2);
 * - 实时标题必须带「当前名称」时点标注(A4);读取失败诚实回退 rel + 原路径 +
 *   「当前不可读」(A5);同对象多字段可辨(声明字段标题,缺失回退原 pointer,A3);
 * - 点击落点保留 thread/scope(A6,沿用 citationCanvasHref);原 FactRef 审计
 *   属性(data-rel、data-pointer 与 title)不丢、无全局标签缓存(A7,每挂载
 *   no-store 重读)。
 * 判别只用 rel/pointer 结构(纯指针前缀),不解析回答自然语言。
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { CitationList } from '../citation-list';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function entityResponse(properties: Record<string, unknown>): Response {
  return Response.json({ class: ['entity'], properties, links: [], actions: [] }, { status: 200 });
}

function chipByRel(rel: string): HTMLElement {
  const chip = screen.getAllByRole('link').find((link) => link.getAttribute('data-rel') === rel);
  if (chip === undefined) throw new Error(`no citation chip for ${rel}`);
  return chip;
}

describe('基线(转正自 citation-list.test.tsx):严格 FactRef chip 与导航声明', () => {
  it('renders only strict structured FactRefs as accessible tail chips', () => {
    window.history.replaceState(
      {},
      '',
      '/entity?rel=articles&scope=publishing&thread=release-1&mode=raw',
    );
    render(
      <CitationList
        citations={[
          { rel: 'post:first-post', pointer: '/properties/fields/body' },
          { rel: 'post:first-post', pointer: '/properties/fields/body' },
          { rel: 'articles', pointer: '/properties/count' },
        ]}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('href')).toBe(
      '/canvas?focus=post%3Afirst-post&scope=publishing&thread=release-1',
    );
    expect(links[0]!.getAttribute('data-nav')).toBe('citation:post:first-post');
    expect(links[0]!.getAttribute('data-pointer')).toBe('/properties/fields/body');
    // A7:JSON Pointer 保留审计口径(title 属性)。
    expect(links[0]!.getAttribute('title')).toContain('/properties/fields/body');
    // A3 降级(反转旧 G10 断言):无声明字段标题时,原 pointer 路径作为字段
    // 对照可见可辨 —— 指针不再只住不可见的 title。
    expect(within(links[0]!).getByText('/properties/fields/body')).toBeTruthy();
    expect(within(links[1]!).getByText('/properties/count')).toBeTruthy();
    // 读取失败/未取到标题:标签诚实回退 rel,不猜名称。
    expect(screen.getAllByText('post:first-post').length).toBeGreaterThan(0);
  });

  it('声明名称成为标签、rel 退为对照,并带「当前名称」时点标注', async () => {
    window.history.replaceState({}, '', '/entity?rel=articles&scope=publishing');
    const fetchMock = vi.fn(async () =>
      Response.json({
        class: ['flow-instance'],
        properties: { rel: 'post:first-post', identity: '第一篇文章' },
        links: [],
        actions: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<CitationList citations={[{ rel: 'post:first-post', pointer: '/properties/count' }]} />);
    await waitFor(() => expect(screen.getByText('第一篇文章')).toBeTruthy());
    // A4(反转):FR8 —— 实时标题必须表明是当前名称。
    expect(screen.getByText(/当前名称/)).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('title')).toContain('/properties/count');
    expect(screen.getByText('post:first-post')).toBeTruthy();
  });

  it('derives current styling only from URL focus and overrides thread for thread targets', () => {
    window.history.replaceState(
      {},
      '',
      '/canvas?focus=thread%3Arelease-2&scope=publishing&thread=release-1&refresh=9',
    );
    render(
      <CitationList citations={[{ rel: 'thread:release-2', pointer: '/properties/status' }]} />,
    );

    const link = screen.getByRole('link');
    expect(link.getAttribute('aria-current')).toBe('location');
    expect(link.getAttribute('href')).toBe(
      '/canvas?focus=thread%3Arelease-2&scope=publishing&thread=release-2',
    );
  });

  it('fails closed for malformed metadata instead of inventing a citation', () => {
    const { container } = render(
      <CitationList citations={[{ rel: 'post:ghost', pointer: 'not-a-json-pointer' }] as never} />,
    );
    expect(container.childElementCount).toBe(0);
  });
});

describe('US09/A1+A2:集合/成员型与精确型可辨,集合重排不指向今日第 N 项', () => {
  it('集合成员 pointer 引用:集合级依据 + 时点边界行,不解引用成员身份', async () => {
    window.history.replaceState({}, '', '/canvas?thread=t56p34-thread-a');
    // 集合响应故意携带当前成员身份(Siren entities[]):组件不得据此把
    // /entities/1 渲染成「今日第 1 项」的具体对象名。
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      Response.json(
        {
          class: ['entity'],
          properties: {
            rel: 'ideas:t56p34',
            identity: '想法清单(今天的成员顺序)',
            count: 3,
          },
          entities: [
            { class: ['entity'], properties: { identity: '今日第 1 项想法X' } },
            { class: ['entity'], properties: { identity: '今日第 2 项想法Y' } },
          ],
          links: [],
          actions: [],
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CitationList citations={[{ rel: 'ideas:t56p34', pointer: '/entities/1/properties/rel' }]} />,
    );

    await waitFor(() => expect(screen.getByText('想法清单(今天的成员顺序)')).toBeTruthy());
    const link = chipByRel('ideas:t56p34');
    // A1:集合型显式标注「集合级依据」,不冒充精确定位。
    expect(within(link).getByText('集合级依据')).toBeTruthy();
    // A2(D78/5 边界行原文):不指向今天同一位置的条目。
    const item = link.closest('li');
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByText(/回答依据当时的集合内容/)).toBeTruthy();
    expect(within(item as HTMLElement).getByText(/不指向今天同一位置的条目/)).toBeTruthy();
    // A2:集合成员重排后不显示「今日第 N 项」对象名 —— 响应中即使携带成员
    // 身份也不得泄入 chip(组件根本不解引用成员)。
    expect(screen.queryByText(/今日第 1 项/)).toBeNull();
    // A4:集合标签同样是实时标题,带「当前名称」标注。
    expect(within(link).getByText(/当前名称/)).toBeTruthy();
    // A6:点击仍落集合实体页,thread 保留(citationCanvasHref 不变)。
    expect(link.getAttribute('href')).toBe(
      `/canvas?focus=${encodeURIComponent('ideas:t56p34')}&thread=t56p34-thread-a`,
    );
    // A7:原 FactRef 审计属性保留。
    expect(link.getAttribute('data-rel')).toBe('ideas:t56p34');
    expect(link.getAttribute('data-pointer')).toBe('/entities/1/properties/rel');
    expect(link.getAttribute('title')).toContain('/entities/1/properties/rel');
    // A2:读取只发顶层集合 rel,不发成员 /entities/1 定位请求。
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(
      fetchMock.mock.calls.every(([input]) =>
        String(input).includes(`rel=${encodeURIComponent('ideas:t56p34')}`),
      ),
    ).toBe(true);
  });

  it('两型并排:精确型无集合徽标与边界行,集合型两者皆有', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.includes('idea%3At56p34-x')
          ? entityResponse({ rel: 'idea:t56p34-x', identity: '单个想法 X' })
          : entityResponse({ rel: 'ideas:t56p34', identity: '想法集合' });
      }),
    );
    render(
      <CitationList
        citations={[
          { rel: 'idea:t56p34-x', pointer: '/' },
          { rel: 'ideas:t56p34', pointer: '/entities/1' },
        ]}
      />,
    );
    await waitFor(() => expect(screen.getByText('单个想法 X')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('想法集合')).toBeTruthy());

    const exact = chipByRel('idea:t56p34-x');
    const collection = chipByRel('ideas:t56p34');
    // 精确型:无「集合级依据」徽标、无时点边界行。
    expect(within(exact).queryByText('集合级依据')).toBeNull();
    const exactItem = exact.closest('li');
    expect(within(exactItem as HTMLElement).queryByText(/回答依据当时的集合内容/)).toBeNull();
    // 集合型:徽标 + 边界行 —— 两型在外观/语义可辨(A1)。
    expect(within(collection).getByText('集合级依据')).toBeTruthy();
    const collectionItem = collection.closest('li');
    expect(within(collectionItem as HTMLElement).getByText(/回答依据当时的集合内容/)).toBeTruthy();
  });
});

describe('US09/A3:同对象多字段可辨(声明字段标题优先,缺失回退原 pointer)', () => {
  it('presentation.fields 声明了字段标题:两 chip 以合同 title 相辨,pointer 留审计', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        entityResponse({
          rel: 'post:t56p34-a',
          identity: '同一篇文章',
          presentation: {
            fields: [
              { path: 'properties.fields.body', title: '正文', role: 'primary-content' },
              { path: 'properties.fields.summary', title: '摘要', role: 'metadata' },
            ],
          },
        }),
      ),
    );
    render(
      <CitationList
        citations={[
          { rel: 'post:t56p34-a', pointer: '/properties/fields/body' },
          { rel: 'post:t56p34-a', pointer: '/properties/fields/summary' },
        ]}
      />,
    );
    await waitFor(() => {
      const chips = screen.getAllByRole('link');
      expect(chips).toHaveLength(2);
      expect(within(chips[0]!).getByText('正文')).toBeTruthy();
      expect(within(chips[1]!).getByText('摘要')).toBeTruthy();
    });
    const chips = screen.getAllByRole('link');
    // 原 pointer 仍在审计 title;可见标签是声明字段标题,且两字段互不串扰。
    expect(chips[0]!.getAttribute('title')).toContain('/properties/fields/body');
    expect(chips[1]!.getAttribute('title')).toContain('/properties/fields/summary');
    expect(within(chips[0]!).queryByText('摘要')).toBeNull();
    expect(within(chips[1]!).queryByText('正文')).toBeNull();
  });

  it('无声明字段标题:两 chip 以原 pointer 路径相辨,不假称定位', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => entityResponse({ rel: 'post:t56p34-b', identity: '同一篇文章' })),
    );
    render(
      <CitationList
        citations={[
          { rel: 'post:t56p34-b', pointer: '/properties/fields/body' },
          { rel: 'post:t56p34-b', pointer: '/properties/fields/summary' },
        ]}
      />,
    );
    await waitFor(() => {
      const chips = screen.getAllByRole('link');
      expect(chips).toHaveLength(2);
      expect(within(chips[0]!).getByText('同一篇文章')).toBeTruthy();
    });
    const chips = screen.getAllByRole('link');
    expect(chips).toHaveLength(2);
    expect(within(chips[0]!).getByText('/properties/fields/body')).toBeTruthy();
    expect(within(chips[0]!).queryByText('/properties/fields/summary')).toBeNull();
    expect(within(chips[1]!).getByText('/properties/fields/summary')).toBeTruthy();
    expect(within(chips[1]!).queryByText('/properties/fields/body')).toBeNull();
  });
});

describe('US09/A4+A5:改名、权限撤回与读取失败的时点诚实(S2 种子反转/保留)', () => {
  it('目标改名后:显示当前名并带「当前名称」标注,不伪造历史名称', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => entityResponse({ rel: 'idea:t56p34-r', identity: '改名后的新标题' })),
    );
    render(
      <CitationList citations={[{ rel: 'idea:t56p34-r', pointer: '/properties/identity' }]} />,
    );
    await waitFor(() => expect(screen.getByText('改名后的新标题')).toBeTruthy());
    // A4(反转 S2「无当前名称标注」缺口):实时标题必须表明是当前名称。
    expect(screen.getByText(/当前名称/)).toBeTruthy();
    // 仍不伪造回答时名称(FactRef 无快照,不可知即不显示)。
    const link = screen.getByRole('link');
    expect(link.getAttribute('title')).not.toContain('旧标题');
    expect(screen.queryByText(/回答时名称/)).toBeNull();
  });

  it('授权撤回(403):回退 rel + 原路径 + 「当前不可读」,不猜名称', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'denied' }), { status: 403 })),
    );
    render(
      <CitationList
        citations={[{ rel: 'idea:t56p34-revoked', pointer: '/properties/identity' }]}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByText('idea:t56p34-revoked').length).toBeGreaterThan(0),
    );
    // A5(新增诚实状态):读取不可读要显式呈现,不把不可读标成空/正常。
    await waitFor(() => expect(screen.getByText('当前不可读')).toBeTruthy());
    expect(within(screen.getByRole('link')).getByText('/properties/identity')).toBeTruthy();
    // 不猜名称、不显示存在性细节;点击仍导航到该 rel(点进去得 denied 回执)。
    expect(screen.getByRole('link').getAttribute('href')).toContain(
      `focus=${encodeURIComponent('idea:t56p34-revoked')}`,
    );
  });

  it('网络失败:同样回退 + 「当前不可读」,引用行不炸整条消息', async () => {
    window.history.replaceState({}, '', '/canvas');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    render(<CitationList citations={[{ rel: 'idea:t56p34-net', pointer: '/' }]} />);
    await waitFor(() => expect(screen.getAllByText('idea:t56p34-net').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('当前不可读')).toBeTruthy());
    // 整条消息的引用区仍渲染(FR9:引用读取不可用不导致整条线空白)。
    expect(screen.getByLabelText('回答依据')).toBeTruthy();
  });

  it('无全局标签缓存:每次挂载都重新 fetch(cache: no-store),失败不持久化', async () => {
    window.history.replaceState({}, '', '/canvas');
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      entityResponse({ rel: 'idea:t56p34-c', identity: '缓存探针标题' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const citations = [{ rel: 'idea:t56p34-c', pointer: '/properties/identity' }];

    const { unmount } = render(<CitationList citations={citations} />);
    await waitFor(() => expect(screen.getByText('缓存探针标题')).toBeTruthy());
    unmount();
    cleanup();

    render(<CitationList citations={citations} />);
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    // 两次挂载各自发起 /api/entity 读取:无模块级/跨实例缓存(D78/5:不建全局
    // 标签缓存、不持久化失败结果),也无「撤回后残留旧标题」问题。
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes('/api/entity'))).toBe(
      true,
    );
  });
});

describe('US09/A6:从 thread 上下文点击引用,落点保留 thread/scope', () => {
  it('citation href 保留当前 URL 的 scope 与 thread 声明', () => {
    window.history.replaceState(
      {},
      '',
      '/canvas?focus=thread%3At56p34-t&scope=publishing&thread=t56p34-t',
    );
    render(
      <CitationList citations={[{ rel: 'idea:t56p34-nav', pointer: '/properties/status' }]} />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(
      `/canvas?focus=${encodeURIComponent('idea:t56p34-nav')}&scope=publishing&thread=t56p34-t`,
    );
    expect(link.getAttribute('data-nav')).toBe('citation:idea:t56p34-nav');
  });
});
