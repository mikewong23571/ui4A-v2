/**
 * 组件测试的浏览器 API stub(vitest jsdom):react-chrono/React Flow 等
 * 库依赖 matchMedia/IntersectionObserver/ResizeObserver——jsdom 缺失,
 * 统一注入极简 stub(零测量/零匹配,布局断言走纯函数或 DOM 锚点)。
 */
import { vi } from 'vitest';

/** 注入 jsdom 缺失的浏览器 API(幂等;测试文件顶层调用一次)。 */
export function stubBrowserApis(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class IntersectionObserverStub {
      root = null;
      rootMargin = '';
      thresholds = [];
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class DOMMatrixReadOnlyStub {
      m22 = 1;
      constructor(_transform?: string) {}
    },
  );
}
