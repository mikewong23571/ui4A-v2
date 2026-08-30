// @vitest-environment jsdom
/**
 * T35 D-7/F-12(用户认可方案):处境收敛为顶栏状态芯片——
 * 站点常显;视角/工作线/注视有值才出现(默认态不占版面);
 * 「在哪」弹层承载全量字段、调整视角(带授权边界一句说明)与跨面桥。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

afterEach(cleanup);

beforeEach(() => {
  location.route = '/canvas?mode=raw&scope=publishing&thread=release-1&focus=post%3Aone';
  location.observation = {
    site: 'workstation',
    scope: 'publishing',
    thread: 'release-1',
    focus: 'post:one',
  };
});

function openPopover(): void {
  fireEvent.click(screen.getByRole('button', { name: /在哪/ }));
}

describe('SituationBar · 状态芯片(F-12)', () => {
  it('站点常显;有值字段以芯片呈现且弹层含全量声明', () => {
    render(<SituationBar />);

    // 站点常显为芯片(任务语标签)。
    expect(screen.getByTestId('situation-site').textContent).toBe('工作站');
    // 有值芯片直接可见。
    expect(screen.getByTestId('situation-scope').textContent).toBe('publishing');
    expect(screen.getByTestId('situation-thread').textContent).toBe('线 release-1');
    expect(screen.getByTestId('situation-focus').textContent).toBe('注视 post:one');
    // 弹层收起时,全量字段(含"未声明"默认态)不占版面。
    expect(screen.queryByText(/不代表已授权/)).toBeNull();
    expect(screen.queryByText(/granted/i)).toBeNull();

    openPopover();
    // 弹层 dl 全量四字段(标签+值)。
    const dialog = screen.getByRole('dialog', { name: '当前在哪' });
    for (const label of ['站点', '视角', '工作线', '注视']) {
      expect(dialog.textContent).toContain(label);
    }
    expect(dialog.textContent).toContain('post:one');
    // 授权边界一句话说明(替代"URL 声明不代表已授权"实现话术)。
    expect(screen.getByText(/切换视角不扩大或缩小权限/)).toBeTruthy();
  });

  it('默认态不渲染芯片(F-12:未声明不占版面)', () => {
    location.observation = { site: 'workstation', scope: null, thread: null, focus: null };
    render(<SituationBar />);

    expect(screen.getByTestId('situation-site').textContent).toBe('工作站');
    expect(screen.queryByTestId('situation-scope')).toBeNull();
    expect(screen.queryByTestId('situation-thread')).toBeNull();
    expect(screen.queryByTestId('situation-focus')).toBeNull();
  });

  it('保留无关 query 字段:退线/清除视角/应用视角(F-12 弹层内)', () => {
    render(<SituationBar />);
    openPopover();

    expect(screen.getByRole('link', { name: '退出工作线' }).getAttribute('href')).toBe(
      '/canvas?mode=raw&scope=publishing&focus=post%3Aone',
    );

    expect(screen.getByRole('link', { name: '清除视角' }).getAttribute('href')).toBe(
      '/canvas?mode=raw&thread=release-1&focus=post%3Aone',
    );
    fireEvent.change(screen.getByRole('textbox', { name: '' }), {
      target: { value: 'development' },
    });
    expect(screen.getByRole('link', { name: '应用视角' }).getAttribute('href')).toBe(
      '/canvas?mode=raw&scope=development&thread=release-1&focus=post%3Aone',
    );
  });

  it('所有可点控件均有 data-nav,且不含授权语义文案(I3 探针)', () => {
    const { container } = render(<SituationBar />);
    openPopover();
    const controls = container.querySelectorAll('a, button, input');
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
