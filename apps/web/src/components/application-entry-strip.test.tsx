// @vitest-environment jsdom
/**
 * T39 G15 Red:Application 是工作站里的图书馆书架,不是 scope switcher 或工作书桌。
 * 可见成员、title、intent、顺序和 landing 全部来自当前已授权 sitemap。
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationEntryStrip } from '@/components/application-entry-strip';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

interface ShelfApplication {
  name: string;
  title: string;
  intent: string;
  entry?: { target: string; role: 'primary-create' | 'primary-task' | 'primary-collection' };
  presentation?: { version: 1; traits: string[] };
}

const installedApplications: readonly ShelfApplication[] = [
  {
    name: 'default',
    title: '默认应用',
    intent: '未显式声明归属时使用的系统地板。',
    presentation: { version: 1, traits: ['system-fallback'] },
  },
  {
    name: 'publishing',
    title: '内容发布',
    intent: '起草文章并管理已经发布的内容。',
    entry: { target: 'flow:article-drafting', role: 'primary-create' },
  },
  {
    name: 'community',
    title: '社区互动',
    intent: '查看评论并处理需要人工裁决的审核责任。',
    entry: { target: 'comments', role: 'primary-collection' },
  },
  {
    name: 'development',
    title: '软件实施',
    intent: '委托受约束的软件变更并审查结果。',
    entry: { target: 'flow:software-change', role: 'primary-task' },
  },
  {
    name: 'editorial',
    title: '编辑写作',
    intent: '发起有来源约束的写作任务并审查交付。',
    entry: { target: 'flow:writing-request', role: 'primary-task' },
  },
  {
    name: 'governance',
    title: 'Agent 治理',
    intent: '审查 Agent Definition 候选并由人决定是否激活。',
    entry: { target: 'flow:agent-definition-authoring', role: 'primary-task' },
  },
  {
    name: 'todo',
    title: '待办事项',
    intent: '捕捉并推进需要完成的待办事项。',
    entry: { target: 'flow:todo-capture', role: 'primary-create' },
  },
  {
    name: 'ideas',
    title: '想法收集',
    intent: '记录想法并保留后续整理的上下文。',
    entry: { target: 'flow:idea-capture', role: 'primary-create' },
  },
] as const;

function stubApplications(applications: readonly ShelfApplication[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ applications }) }),
  );
}

function shelfLinks(): HTMLAnchorElement[] {
  const shelf = screen.getByRole('region', { name: '应用' });
  return Array.from(shelf.querySelectorAll<HTMLAnchorElement>('a[data-nav^="local:app-entry:"]'));
}

function hrefOf(link: HTMLAnchorElement): URL {
  return new URL(link.href, 'http://localhost:3100');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ApplicationEntryStrip · T39 Application 图书馆', () => {
  it('按 sitemap 声明顺序展示全部 authorized business Applications 的 title 与可触达 intent', async () => {
    stubApplications(installedApplications);
    render(<ApplicationEntryStrip />);

    await screen.findByRole('region', { name: '应用' });
    const expected = installedApplications.slice(1);
    const links = shelfLinks();

    expect(links).toHaveLength(expected.length);
    expect(links.map((link) => link.getAttribute('data-nav'))).toEqual(
      expected.map(({ name }) => `local:app-entry:${name}`),
    );
    for (const application of expected) {
      const link = links.find(
        (candidate) => candidate.getAttribute('data-nav') === `local:app-entry:${application.name}`,
      );
      expect(link, `${application.name} 应在书架中`).toBeDefined();
      expect(within(link!).getByText(application.title)).toBeTruthy();
      expect(within(link!).getByText(application.intent)).toBeTruthy();
    }

    expect(screen.queryByRole('button', { name: /更多应用/ })).toBeNull();
    expect(screen.queryByText('默认应用')).toBeNull();
  });

  it('当前 lens 仅作 aria-current 轻强调,不收窄授权集合;每个入口保留 thread/returnTo 并显式进入 canonical landing', async () => {
    window.history.pushState(
      {},
      '',
      '/canvas?scope=development&thread=release-1&returnTo=%2Fthreads%3Fview%3Dmine',
    );
    stubApplications(installedApplications);
    render(<ApplicationEntryStrip />);

    await screen.findByRole('region', { name: '应用' });
    const links = shelfLinks();
    expect(links).toHaveLength(7);

    for (const application of installedApplications.slice(1)) {
      const link = links.find(
        (candidate) => candidate.getAttribute('data-nav') === `local:app-entry:${application.name}`,
      );
      expect(link, `${application.name} 应在当前 lens 外仍可达`).toBeDefined();
      const url = hrefOf(link!);
      expect(url.pathname).toBe('/canvas');
      expect(url.searchParams.get('scope')).toBe(application.name);
      expect(url.searchParams.get('focus')).toBe(`workspace:app:${application.name}`);
      expect(url.searchParams.get('thread')).toBe('release-1');
      expect(url.searchParams.get('returnTo')).toBe('/threads?view=mine');
      expect(link!.getAttribute('aria-current')).toBe(
        application.name === 'development' ? 'page' : null,
      );
    }
  });

  it('future 第九个 Application 只加入合成 sitemap 即自动出现在声明位置并获得 landing', async () => {
    const research: ShelfApplication = {
      name: 'research',
      title: '研究素材',
      intent: '收集可追溯的研究素材并等待后续整理。',
    };
    stubApplications([...installedApplications, research]);
    render(<ApplicationEntryStrip />);

    await screen.findByRole('region', { name: '应用' });
    const links = shelfLinks();
    expect(links).toHaveLength(8);
    expect(links.at(-1)?.getAttribute('data-nav')).toBe('local:app-entry:research');
    const futureLink = links.at(-1)!;
    expect(within(futureLink).getByText('研究素材')).toBeTruthy();
    expect(within(futureLink).getByText(research.intent)).toBeTruthy();
    expect(hrefOf(futureLink).searchParams.get('focus')).toBe('workspace:app:research');
  });

  it('书架不冒充工作书桌或 Scope 开关,不展示 principal inbox/thread 状态', async () => {
    stubApplications(installedApplications);
    render(<ApplicationEntryStrip />);

    const shelf = await screen.findByRole('region', { name: '应用' });
    expect(shelf.textContent).not.toMatch(/切换\s*Scope|Scope\s*切换/i);
    expect(shelf.textContent).not.toContain('收件箱');
    expect(shelf.textContent).not.toContain('工作线');
    expect(shelf.textContent).not.toContain('进行中');
    expect(shelf.querySelector('[data-inbox-count], [data-thread-count]')).toBeNull();
  });

  it('非法 presentation 不能建立业务 Application 书架成员资格', async () => {
    stubApplications([
      ...installedApplications,
      {
        name: 'malformed',
        title: '错误声明',
        intent: '不应以猜测方式进入书架。',
        presentation: { version: 1, traits: ['unknown-trait'] },
      } as unknown as ShelfApplication,
    ]);
    render(<ApplicationEntryStrip />);

    await screen.findByRole('region', { name: '应用' });
    expect(screen.queryByText('错误声明')).toBeNull();
  });
});
