// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EmptyStateWord } from './empty-state';

afterEach(cleanup);

describe('empty-state closed Presentation policy', () => {
  it.each([
    ['no-current-responsibility', '当前没有需要你处理的事项。'],
    ['no-results', '没有符合当前条件的结果。'],
    ['ready-to-start', '这里还没有内容，可以使用本页的主要任务开始。'],
    ['nothing-in-motion', '当前没有正在推进的工作。'],
  ])('renders %s as task language', (meaning, copy) => {
    render(<EmptyStateWord meaning={meaning} />);
    expect(screen.getByRole('status').textContent).toBe(copy);
  });

  it('rejects values outside the closed cognition vocabulary', () => {
    expect(() => render(<EmptyStateWord meaning="invent-a-button" />)).toThrow(/empty-state/);
  });
});
