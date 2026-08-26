// @vitest-environment jsdom
/**
 * T27 Phase C：站点导航只保留人的主任务；底层队列、审计与执行入口按需展开。
 * 六条既有路由仍可达，raw 只在 T28 作为查看模式出现，不成为顶级入口。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SiteNav } from '@/components/site-nav';

afterEach(cleanup);

function expectLink(group: HTMLElement, label: string, href: string, nav: string): void {
  const link = within(group).getByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe(href);
  expect(link.getAttribute('data-nav')).toBe(nav);
}

describe('SiteNav · workstation / meta / 系统区', () => {
  it('以任务语言呈现 workstation 主入口与显式 meta 入口', () => {
    render(<SiteNav />);

    const navigation = screen.getByRole('navigation', { name: '全站导航' });
    const workstation = within(navigation).getByRole('group', { name: '工作站' });
    const meta = within(navigation).getByRole('group', { name: '定义站' });

    expectLink(workstation, '我的事', '/', 'home');
    expectLink(workstation, '共同注视', '/canvas', 'canvas');
    expectLink(meta, '定义管理', '/meta', 'meta');
  });

  it('把壳级入口收进可按需展开的系统区，并保留原路由', () => {
    const { container } = render(<SiteNav />);

    const system = container.querySelector('details');
    expect(system).not.toBeNull();
    expect(system!.hasAttribute('open')).toBe(false);
    expect(system!.querySelector('summary')?.textContent).toContain('系统');
    expect(system!.querySelector('summary')?.getAttribute('data-nav')).toBe('local:system-menu');

    fireEvent.click(system!.querySelector('summary')!);
    expect(system!.hasAttribute('open')).toBe(true);

    expectLink(system!, '收件箱', '/entity?rel=inbox', 'inbox');
    expectLink(system!, '事件流', '/events', 'events');
    expectLink(system!, '委托监控', '/delegations', 'delegations');
  });

  it('所有可点控件均有 data-nav，且 raw 没有顶级入口', () => {
    const { container } = render(<SiteNav />);

    const controls = Array.from(
      container.querySelectorAll<HTMLElement>('a, button, summary, [role="button"]'),
    );
    expect(controls).toHaveLength(7);
    expect(controls.filter((control) => !control.hasAttribute('data-nav'))).toEqual([]);
    expect(container.querySelector('a[href="/raw"]')).toBeNull();
    expect(container.textContent).not.toContain('原始合同');
  });
});
