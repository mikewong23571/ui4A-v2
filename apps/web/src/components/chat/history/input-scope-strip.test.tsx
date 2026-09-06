// @vitest-environment jsdom
/**
 * InputScopeStrip 组件测试(T56 P3.3 / US08「当前输入范围正确」):
 * 输入区附近的当前线/对象提示与发送侧 clientView 取自同一 URL observation
 * 单一来源(presenceObservationForLocation;不新建 attention/authorization
 * store,design §2「当前提问对象」行)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn() }),
}));

import { clientViewReportForLocation } from '@/chat/client-view';
import { presenceObservationForLocation } from '@/presence/client';

import { InputScopeStrip } from './input-scope-strip';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('InputScopeStrip(当前输入范围与 URL observation 同源)', () => {
  it('有 thread/focus 的 URL:提示值与发送侧 clientViewReportForLocation 从同一 URL 得到的观察一致', () => {
    const route = `/canvas?scope=publishing&thread=${encodeURIComponent('thread:t1')}&focus=${encodeURIComponent('idea:x')}`;
    window.history.replaceState({}, '', route);
    render(<InputScopeStrip />);

    const strip = screen.getByTestId('input-scope-strip');
    // 同源断言:组件展示值 === 同一 URL 的 presence observation === 发送侧
    // clientView 的 presence 字段(三个来源逐字段相等)。
    const observation = presenceObservationForLocation(route);
    expect(strip.getAttribute('data-thread')).toBe(observation.thread);
    expect(strip.getAttribute('data-scope')).toBe(observation.scope);
    expect(strip.getAttribute('data-focus')).toBe(observation.focus);
    const report = clientViewReportForLocation('strip-test-client', route);
    expect(report.presence.thread).toBe(strip.getAttribute('data-thread'));
    expect(report.presence.focus).toBe(strip.getAttribute('data-focus'));
    expect(report.presence.scope).toBe(strip.getAttribute('data-scope'));
    expect(strip.textContent).toContain(`线 thread:t1`);
    expect(strip.textContent).toContain('注视 idea:x');
  });

  it('非首页无 thread/focus 的 URL:显式「未定位」,不猜当前范围', () => {
    window.history.replaceState({}, '', '/canvas');
    render(<InputScopeStrip />);
    const strip = screen.getByTestId('input-scope-strip');
    expect(strip.getAttribute('data-thread')).toBeNull();
    expect(strip.getAttribute('data-focus')).toBeNull();
    expect(strip.textContent).toContain('未定位');
  });

  it('首页披露真实声明的根集合,与发送侧 selection 一致', () => {
    window.history.replaceState({}, '', '/');
    render(<InputScopeStrip />);
    const roots = ['inbox', 'threads-current', 'delegations-current'];
    const strip = screen.getByTestId('input-scope-strip');
    expect(strip.getAttribute('data-thread')).toBeNull();
    expect(strip.getAttribute('data-focus')).toBe(roots.join(','));
    expect(strip.textContent).toContain(`注视 ${roots.join('、')}`);
    expect(clientViewReportForLocation('home-strip-test', '/').presence.focus).toEqual({
      selection: roots,
    });
    expect(strip.textContent).not.toContain('未定位');
  });
});
