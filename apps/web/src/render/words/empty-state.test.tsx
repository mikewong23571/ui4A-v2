// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EmptyStateWord } from './empty-state';

afterEach(cleanup);

describe('empty-state closed Presentation policy', () => {
  it.each([
    ['no-current-responsibility', '当前可见范围没有需要你处理的事项。'],
    ['no-results', '没有符合当前条件的结果。'],
    ['ready-to-start', '这里还没有内容，可以使用本页的主要任务开始。'],
    ['nothing-in-motion', '当前可见列表没有进行中的事项。'],
  ])('renders %s as task language', (meaning, copy) => {
    render(<EmptyStateWord meaning={meaning} />);
    expect(screen.getByRole('status').textContent).toBe(copy);
  });

  it('keeps the visible-scope wording discipline (D78 决定 3:禁全称断言)', () => {
    for (const meaning of [
      'no-current-responsibility',
      'no-results',
      'ready-to-start',
      'nothing-in-motion',
    ] as const) {
      render(<EmptyStateWord meaning={meaning} />);
      const copy = screen.getByRole('status').textContent ?? '';
      expect(copy.includes('当前没有') || copy.includes('没有任何')).toBe(false);
      cleanup();
    }
  });

  it('rejects values outside the closed cognition vocabulary', () => {
    expect(() => render(<EmptyStateWord meaning="invent-a-button" />)).toThrow(/empty-state/);
  });
});
