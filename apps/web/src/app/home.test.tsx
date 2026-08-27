// @vitest-environment jsdom
/** T27 Phase D：首页是独立的“家”，内容面只挂共享 Presentation 宿主。 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/app-shell';
import { stubBrowserApis } from '@/test/browser-stubs';

import Home from './page';

stubBrowserApis();

const { presentationSurfaceHostSpy } = vi.hoisted(() => ({
  presentationSurfaceHostSpy: vi.fn(),
}));

vi.mock('@/components/canvas/presentation-surface-host', () => ({
  PresentationSurfaceHost: (props: { heading: string; parameters: { focus: string } }) => {
    presentationSurfaceHostSpy(props);
    return (
      <section data-testid="shared-presentation-host">
        <h1>{props.heading}</h1>
        <div data-surface="presentation-workspace%3Amy-work" />
      </section>
    );
  },
}));

afterEach(() => {
  cleanup();
  presentationSurfaceHostSpy.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  stubBrowserApis();
});

describe('首页 `/` 页面边界', () => {
  it('作为独立的家挂入 AppShell，不重定向到 /canvas', () => {
    window.history.pushState({}, '', '/');
    const { container } = render(
      <AppShell>
        <Home />
      </AppShell>,
    );

    const mains = container.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]!.childElementCount).toBeGreaterThan(0);
    expect(container.querySelector('header a[data-nav="home"]')?.getAttribute('href')).toBe('/');
    expect(window.location.pathname).toBe('/');
  });

  it('所有可点击或可提交元素都有 data-nav/data-action，不假设首页零提交控件', () => {
    const { container } = render(
      <AppShell>
        <Home />
      </AppShell>,
    );

    const controls = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button, a, [role="button"], form, input[type="submit"], input[type="button"]',
      ),
    );
    expect(controls.length, 'I3 探针必须观察到至少一个可交互元素').toBeGreaterThan(0);
    expect(
      controls.filter(
        (element) => !element.hasAttribute('data-action') && !element.hasAttribute('data-nav'),
      ),
    ).toEqual([]);
  });

  it('固定以精确 workspace subject 挂载共享 Sidecar 单树宿主', () => {
    render(<Home />);

    expect(presentationSurfaceHostSpy).toHaveBeenCalledTimes(1);
    expect(presentationSurfaceHostSpy).toHaveBeenCalledWith({
      heading: '我的事',
      parameters: { focus: 'workspace:my-work' },
    });
    expect(screen.getByTestId('shared-presentation-host')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '我的事', level: 1 })).toBeTruthy();
  });

  it('不再渲染旧首页的硬编码内容面;书架层(应用目录条)先于主面(F-23)', () => {
    const { container } = render(<Home />);
    const host = screen.getByTestId('shared-presentation-host');

    // T35 F-23:首页 = 应用目录条(壳级书架,数据来自 sitemap)+ 主面;两者都不是
    // 旧首页的硬编码内容面。
    expect(container.childElementCount).toBe(2);
    expect(
      container.firstElementChild?.getAttribute('data-testid'),
    ).toBe('application-entry-strip');
    expect(container.lastElementChild).toBe(host);
  });
});
