// @vitest-environment jsdom
/**
 * T27 Phase B：首页测试只固定“家”的页面边界与 I3 交互合同。
 *
 * 旧首页的文章、评论、收件箱、委托、运行概览和计数都是即将退役的硬编码
 * 内容面，不再由本文件冻结。Phase D 会把下面两个 todo 升为共享 Presentation
 * 宿主的行为测试；在此之前不以伪实现让 Phase B 永久为红。
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/app-shell';
import { stubBrowserApis } from '@/test/browser-stubs';

import Home from './page';

stubBrowserApis();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  stubBrowserApis();
});

/**
 * 本 Phase 只测同步页面边界。让旧 HomeBody 的异步取数保持 pending，避免把
 * 它的私有端点清单重新写进首页合同；卸载时其 effect 会正常取消。
 */
function holdContractReads(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
}

describe('首页 `/` 页面边界', () => {
  it('作为独立的家挂入 AppShell，并由壳提供唯一稳定 main 锚点', () => {
    holdContractReads();
    const { container } = render(
      <AppShell>
        <Home />
      </AppShell>,
    );

    const mains = container.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]!.childElementCount).toBeGreaterThan(0);
    expect(container.querySelector('header a[data-nav="home"]')?.getAttribute('href')).toBe('/');
  });

  it('所有可点击或可提交元素都有 data-nav/data-action，不假设首页零提交控件', () => {
    holdContractReads();
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

  it.todo('Phase D：首页固定请求 subject=workspace:my-work');
  it.todo('Phase D：首页与 /canvas 复用同一 Sidecar 单树宿主和 action gate');
});
