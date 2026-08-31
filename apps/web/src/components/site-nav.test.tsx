// @vitest-environment jsdom
/**
 * T27 Phase C：站点导航只保留人的主任务；底层队列、审计与执行入口按需展开。
 * 六条既有路由仍可达，raw 只在 T28 作为查看模式出现，不成为顶级入口。
 * T35 F-18/F-19：当前项路由派生(aria-current)；系统区受控弹出层,路由变化收起。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteNav } from '@/components/site-nav';

const pathnameMock = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock.value,
}));

afterEach(cleanup);

function renderNav(): HTMLElement {
  const { container } = render(<SiteNav />);
  return container;
}

function expectLink(
  group: HTMLElement,
  label: string,
  href: string,
  nav: string,
  role = 'link',
): void {
  const link = within(group).getByRole(role, { name: label });
  expect(link.getAttribute('href')).toBe(href);
  expect(link.getAttribute('data-nav')).toBe(nav);
}

describe('SiteNav · workstation / meta / 系统区', () => {
  afterEach(() => {
    pathnameMock.value = '/';
  });

  it('以任务语言呈现 workstation 主入口与显式 meta 入口', () => {
    const container = renderNav();

    const navigation = screen.getByRole('navigation', { name: '全站导航' });
    const workstation = within(navigation).getByRole('group', { name: '工作站' });
    const meta = within(navigation).getByRole('group', { name: '定义站' });

    expectLink(workstation, '我的事', '/', 'home');
    expectLink(workstation, '共同注视', '/canvas', 'canvas');
    expectLink(workstation, '应用', '/applications', 'applications');
    expectLink(meta, '定义管理', '/meta', 'meta');
    expect(container.querySelector('a[href="/raw"]')).toBeNull();
  });

  it('当前项带 aria-current=page 与高亮,非当前项弱化(F-18)', () => {
    pathnameMock.value = '/canvas';
    renderNav();

    const current = screen.getByRole('link', { name: '共同注视' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('text-foreground');
    const home = screen.getByRole('link', { name: '我的事' });
    expect(home.getAttribute('aria-current')).toBeNull();
    expect(home.className).toContain('text-muted-foreground');
  });

  it('把壳级入口收进受控系统区:展开可见、路由变化自动收起(F-13/F-19)', () => {
    renderNav();

    const trigger = screen.getByRole('button', { name: /系统/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu', { name: '系统入口' })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: '系统入口' });
    expectLink(menu, '收件箱', '/entity?rel=inbox', 'inbox', 'menuitem');
    expectLink(menu, '事件流', '/events', 'events', 'menuitem');
    expectLink(menu, '委托监控', '/delegations', 'delegations', 'menuitem');

    // 路由变化(pathname 改变触发 effect)后菜单自动收起。
    pathnameMock.value = '/events';
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu', { name: '系统入口' })).toBeNull();
  });

  it('所有可点控件均有 data-nav，且 raw 没有顶级入口', () => {
    const container = renderNav();

    const controls = Array.from(
      container.querySelectorAll<HTMLElement>('a, button, [role="button"]'),
    );
    expect(controls.filter((control) => !control.hasAttribute('data-nav'))).toEqual([]);
    expect(container.querySelector('a[href="/raw"]')).toBeNull();
    expect(container.textContent).not.toContain('原始合同');
  });
});
