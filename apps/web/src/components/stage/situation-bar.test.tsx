// @vitest-environment jsdom
/**
 * T35 D-7/F-12(用户认可方案):处境收敛为顶栏状态芯片——
 * 站点常显;视角/工作线/注视有值才出现(默认态不占版面);
 * 「在哪」弹层承载全量字段、授权选项驱动的视角选择与跨面桥。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({
  route: '/canvas?mode=raw&scope=publishing&thread=release-1&focus=post%3Aone',
  observation: {
    site: 'workstation' as string,
    scope: 'publishing' as string | null,
    thread: 'release-1' as string | null,
    focus: 'post:one' as string | { selection: string[] } | null,
  },
}));

vi.mock('@/presence/location', () => ({
  useLocationObservation: () => location,
}));

import { SituationBar } from './situation-bar';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  location.route = '/canvas?mode=raw&scope=publishing&thread=release-1&focus=post%3Aone';
  location.observation = {
    site: 'workstation',
    scope: 'publishing',
    thread: 'release-1',
    focus: 'post:one',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('rel=threads')) return new Response(JSON.stringify({ entities: [] }));
      if (url.includes('rel=thread%3Arelease-1')) {
        return new Response(
          JSON.stringify({
            class: ['work-thread'],
            properties: { rel: 'thread:release-1', identity: '发布秋季公告' },
            actions: [],
            links: ['post:one', 'draft:one', 'confirmation:one', 'post:two', 'post:three'].map(
              (rel, index) => ({
                rel: [index === 2 ? 'approval' : index === 1 ? 'active' : 'context'],
                href: `/api/entity?rel=${encodeURIComponent(rel)}`,
              }),
            ),
            entities: [],
          }),
        );
      }
      if (url.includes('/api/entity?')) {
        const rel = new URL(url, 'http://ui4a.local').searchParams.get('rel');
        const titles: Record<string, string> = {
          'post:one': '秋季公告',
          'draft:one': '公告草稿',
          'confirmation:one': '发布审批',
          'post:two': '相关资料',
          'post:three': '不展开的第五项',
          'meta/flow:article-drafting': '文章发布向导',
        };
        return new Response(
          JSON.stringify({
            class: ['entity'],
            properties: { rel, title: titles[rel ?? ''] },
            actions: [],
            links: [],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          applications: [
            ['publishing', '内容发布'],
            ['community', '社区互动'],
            ['development', '软件实施'],
          ].map(([name, title]) => ({
            name,
            title,
          })),
        }),
      );
    }),
  );
});

function openPopover(): void {
  fireEvent.click(screen.getByRole('button', { name: /在哪/ }));
}

describe('SituationBar · 状态芯片(F-12)', () => {
  it.each(['release-1', 'thread:release-1'])(
    '注视当前工作线时不重复显示顶栏芯片（%s）',
    async (currentThread) => {
      location.route = `/entity?rel=thread%3Arelease-1&thread=${encodeURIComponent(currentThread)}`;
      location.observation = {
        site: 'workstation',
        scope: null,
        thread: currentThread,
        focus: 'thread:release-1',
      };
      render(<SituationBar />);
      await waitFor(() =>
        expect(screen.getByTestId('situation-thread').textContent).toBe('发布秋季公告'),
      );
      expect(screen.getAllByText('发布秋季公告')).toHaveLength(1);
      expect(screen.queryByTestId('situation-focus')).toBeNull();
      openPopover();
      const dialog = screen.getByRole('dialog', { name: '当前在哪' });
      await waitFor(() =>
        expect(within(dialog).getByTestId('situation-focus').textContent).toBe('发布秋季公告'),
      );
      expect(within(dialog).getByText('当前对象')).toBeTruthy();
    },
  );

  it.each([
    ['meta/applications', '应用定义'],
    ['meta/new-resources', '新的资源定义'],
    ['new-collection', '未来业务集合'],
  ])('无标题集合 %s 使用同平面的授权发现标题', async (rel, title) => {
    const meta = rel.startsWith('meta/');
    location.route = `${meta ? '/meta' : ''}/entity?rel=${encodeURIComponent(rel)}`;
    location.observation = {
      site: meta ? 'meta' : 'workstation',
      scope: null,
      thread: null,
      focus: rel,
    };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const endpoint = String(input);
      if (endpoint === (meta ? '/_meta/.well-known/ui4a.json' : '/.well-known/ui4a.json')) {
        return Response.json({ surfaces: [{ rel, title }], applications: [] });
      }
      if (endpoint.includes('/api/entity?'))
        return Response.json({ properties: { rel }, links: [] });
      return Response.json({ applications: [] });
    });
    render(<SituationBar />);
    await waitFor(() => expect(screen.getByTestId('situation-focus').textContent).toBe(title));
    const metaReads = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input) === '/_meta/.well-known/ui4a.json');
    expect(metaReads.length).toBe(meta ? 1 : 0);
  });

  it('对象读取被拒时不从发现合同补回标题', async () => {
    location.route = '/meta/entity?rel=meta%2Fnew-resources';
    location.observation = { site: 'meta', scope: null, thread: null, focus: 'meta/new-resources' };
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes('/api/entity?')
        ? new Response('', { status: 403 })
        : Response.json({ surfaces: [{ rel: 'meta/new-resources', title: '不应显示的名称' }] }),
    );
    render(<SituationBar />);
    await waitFor(() => expect(screen.getByTestId('situation-focus').textContent).toBe('无法读取'));
    expect(screen.queryByText('不应显示的名称')).toBeNull();
  });

  it.each(['a', 'thread:a'])(
    '切换工作线同步页面对象并保留应用与返回位置（%s）',
    async (currentThread) => {
      location.route = `/entity?rel=thread%3Aa&thread=${encodeURIComponent(currentThread)}&scope=publishing&returnTo=%2Fthreads`;
      location.observation = {
        site: 'workstation',
        scope: 'publishing',
        thread: currentThread,
        focus: 'thread:a',
      };
      const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const rel = new URL(String(input), 'http://ui4a.local').searchParams.get('rel');
        if (rel === 'threads')
          return Response.json({
            entities: [
              { properties: { rel: 'thread:a', identity: '当前工作' } },
              { properties: { rel: 'thread:b', identity: '下一件事' } },
            ],
          });
        if (rel === 'thread:a')
          return Response.json({ properties: { rel, identity: '当前工作' }, links: [] });
        return defaultFetch(input, init);
      });
      render(<SituationBar />);
      openPopover();
      const destination = await screen.findByRole('link', { name: '下一件事' });
      expect(destination.getAttribute('href')).toBe(
        '/entity?rel=thread%3Ab&thread=b&scope=publishing&returnTo=%2Fthreads',
      );
      expect(destination.getAttribute('data-nav')).toBe('situation:switch-thread:b');
      expect(document.querySelector('[data-nav="situation:switch-thread:a"]')).toBeNull();
      expect(
        vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('thread%3Athread%3A')),
      ).toBe(false);
    },
  );

  it('站点常显;应用、工作线与对象显示合同标题', async () => {
    render(<SituationBar />);

    // 站点常显为芯片(任务语标签)。
    expect(screen.getByTestId('situation-site').textContent).toBe('工作站');
    // 有值芯片直接可见。
    await waitFor(() => expect(screen.getByTestId('situation-scope').textContent).toBe('内容发布'));
    await waitFor(() =>
      expect(screen.getByTestId('situation-thread').textContent).toBe('发布秋季公告'),
    );
    await waitFor(() => expect(screen.getByTestId('situation-focus').textContent).toBe('秋季公告'));
    // 弹层收起时,全量字段(含"未声明"默认态)不占版面。
    expect(screen.queryByText(/不代表已授权/)).toBeNull();
    expect(screen.queryByText(/granted/i)).toBeNull();

    openPopover();
    // 弹层 dl 全量四字段(标签+值)。
    const dialog = screen.getByRole('dialog', { name: '当前在哪' });
    for (const label of ['站点', '应用', '工作线', '当前对象']) {
      expect(dialog.textContent).toContain(label);
    }
    await waitFor(() => expect(dialog.textContent).toContain('秋季公告'));
    expect(dialog.textContent).not.toContain('post:one');
    expect(screen.queryByText(/凭证授予|不扩大或缩小权限/)).toBeNull();
  });

  it('默认态不渲染芯片(F-12:未声明不占版面)', () => {
    location.observation = { site: 'workstation', scope: null, thread: null, focus: null };
    render(<SituationBar />);

    expect(screen.getByTestId('situation-site').textContent).toBe('工作站');
    expect(screen.queryByTestId('situation-scope')).toBeNull();
    expect(screen.queryByTestId('situation-thread')).toBeNull();
    expect(screen.queryByTestId('situation-focus')).toBeNull();
  });

  it('无显式视角在「当前在哪」中显示全部已授权应用，不暗选首个授予应用', async () => {
    location.route = '/meta?thread=release-1&returnTo=%2Fthreads';
    location.observation = {
      site: 'meta',
      scope: null,
      thread: 'release-1',
      focus: null,
    };

    render(<SituationBar />);
    expect(screen.queryByTestId('situation-scope')).toBeNull();

    openPopover();
    expect(screen.getByTestId('situation-scope').textContent).toBe('全部已授权应用');
    expect(screen.getByTestId('situation-focus').textContent).toBe('未聚焦对象');
    expect(screen.queryByText(/当前浏览全部已授权应用/)).toBeNull();
    expect(screen.queryByRole('link', { name: '清除应用' })).toBeNull();
    const selector = await screen.findByRole('combobox', { name: '应用' });
    expect((selector as HTMLSelectElement).value).toBe('');
    expect(await screen.findByRole('option', { name: '内容发布' })).toBeTruthy();
  });

  it('未进入工作线或聚焦对象时使用任务文案，不暴露原始 null', () => {
    location.route = '/meta';
    location.observation = { site: 'meta', scope: null, thread: null, focus: null };

    render(<SituationBar />);
    openPopover();

    const dialog = screen.getByRole('dialog', { name: '当前在哪' });
    expect(screen.getByTestId('situation-thread').textContent).toBe('未进入工作线');
    expect(screen.getByTestId('situation-focus').textContent).toBe('未聚焦对象');
    expect(dialog.textContent).not.toContain('null');
  });

  it('显式应用是轻量芯片，不以 Scope 或视角命名', async () => {
    render(<SituationBar />);

    const currentView = await screen.findByRole('link', { name: '当前应用 内容发布' });
    expect(currentView.getAttribute('data-nav')).toBe('situation:clear-scope');
    expect(currentView.className).toContain('rounded-full');
    expect(currentView.className).toContain('text-[11px]');
    expect(screen.queryByText(/Scope/)).toBeNull();
  });

  it('保留无关 query 字段:退线/清除视角/应用视角(F-12 弹层内)', async () => {
    location.route =
      '/canvas?mode=raw&scope=publishing&thread=release-1&focus=post%3Aone&returnTo=%2Fthreads';
    render(<SituationBar />);
    openPopover();

    expect(screen.getByRole('link', { name: '退出工作线' }).getAttribute('href')).toBe(
      '/canvas?mode=raw&scope=publishing&focus=post%3Aone&returnTo=%2Fthreads',
    );

    expect(screen.getByRole('link', { name: '清除应用' }).getAttribute('href')).toBe(
      '/canvas?mode=raw&thread=release-1&focus=post%3Aone&returnTo=%2Fthreads',
    );
    await screen.findByRole('option', { name: '软件实施' });
    const selector = screen.getByRole('combobox', { name: '应用' });
    fireEvent.change(selector, {
      target: { value: 'development' },
    });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: '切换应用' }).getAttribute('href')).toBe(
        '/canvas?mode=raw&scope=development&thread=release-1&focus=post%3Aone&returnTo=%2Fthreads',
      ),
    );
  });

  it('在既有弹层中展示最多四个显式关联对象，不新增说明段落', async () => {
    render(<SituationBar />);
    openPopover();
    const related = await screen.findByRole('navigation', { name: '关联对象' });
    await waitFor(() => expect(within(related).getAllByRole('link')).toHaveLength(4));
    expect(within(related).getByRole('link', { name: '公告草稿' }).getAttribute('href')).toBe(
      '/meta/entity?rel=draft%3Aone&scope=publishing&thread=release-1',
    );
    expect(within(related).getByRole('link', { name: '发布审批' })).toBeTruthy();
    expect(screen.queryByText('不展开的第五项')).toBeNull();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/scope|范围是什么|上下文范围/);
  });

  it('所有可点控件均有 data-nav,且不含授权语义文案(I3 探针)', () => {
    const { container } = render(<SituationBar />);
    openPopover();
    const controls = container.querySelectorAll('a, button, input, select');
    expect(controls.length).toBeGreaterThan(0);
    expect(
      [...controls].filter(
        (control) => !control.hasAttribute('data-nav') && !control.hasAttribute('data-action'),
      ),
    ).toEqual([]);
    expect(container.textContent).not.toContain('不代表已授权');
  });

  it('跨面桥在弹层内:workstation→meta 编辑桥保留 scope/thread', () => {
    location.route = '/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=release-1';
    location.observation = {
      site: 'workstation',
      scope: 'publishing',
      thread: 'release-1',
      focus: 'flow:article-drafting',
    };

    render(<SituationBar />);
    openPopover();

    const bridge = screen.getByRole('link', { name: '在 meta 中编辑此定义' });
    expect(bridge.getAttribute('href')).toBe(
      '/meta/entity?rel=meta%2Fflow%3Aarticle-drafting&scope=publishing&thread=release-1',
    );
    expect(bridge.getAttribute('data-nav')).toBe('situation:cross-site-flow');
  });

  it('meta 站桥接为查看活实例;无桥焦点不渲染(F-25 后续迁移内容上下文)', () => {
    location.route =
      '/meta/entity?rel=meta%2Fflow%3Aarticle-drafting&scope=publishing&thread=release-1';
    location.observation = {
      site: 'meta',
      scope: 'publishing',
      thread: 'release-1',
      focus: 'meta/flow:article-drafting',
    };
    const { rerender } = render(<SituationBar />);
    openPopover();

    expect(screen.getByRole('link', { name: '查看活实例' }).getAttribute('href')).toBe(
      '/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=release-1',
    );

    location.route = '/canvas?focus=post%3Aone&scope=publishing';
    location.observation = {
      site: 'workstation',
      scope: 'publishing',
      thread: null,
      focus: 'post:one',
    };
    rerender(<SituationBar />);
    expect(screen.queryByRole('link', { name: /meta 中编辑|查看活实例/ })).toBeNull();
  });
});
