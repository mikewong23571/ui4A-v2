// @vitest-environment jsdom
/** T35 F-23/F-26:应用目录条——sitemap 派生、零特判、阈值折叠、默认应用不出现在书架。 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationEntryStrip } from '@/components/application-entry-strip';

afterEach(cleanup);

function stubApplications(applications: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ applications }) }),
  );
}

describe('ApplicationEntryStrip · 应用目录条', () => {
  it('从 sitemap 派生应用 chips 并链到应用默认组合面,排除 default(F-23/T37 FR3)', async () => {
    stubApplications([
      { name: 'default', title: '默认应用', intent: '兜底', entry: 'flow:article-drafting' },
      { name: 'todo', title: '待办事项', intent: '捕捉待办', entry: 'flow:todo-capture' },
    ]);
    render(<ApplicationEntryStrip />);

    const todo = await screen.findByRole('link', { name: '待办事项' });
    // T37:chip 默认落点 = 应用组合面(scope 无 focus),不再携带 entry focus。
    expect(todo.getAttribute('href')).toBe('/canvas?scope=todo');
    expect(screen.queryByRole('link', { name: '默认应用' })).toBeNull();
    expect(screen.getByText('应用（1 个）')).toBeTruthy();
  });

  it('超过阈值默认折叠为"更多应用",展开后全量可见(F-26)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const many = Array.from({ length: 8 }, (_, index) => ({
      name: `app-${index}`,
      title: `应用${index}`,
      intent: '测试',
      entry: `flow:app-${index}`,
    }));
    stubApplications(many);
    render(<ApplicationEntryStrip />);

    expect(await screen.findByText('应用（8 个）')).toBeTruthy();
    const more = screen.getByRole('button', { name: /更多应用（2）/ });
    expect(screen.queryByRole('link', { name: '应用7' })).toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole('link', { name: '应用7' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /更多应用/ })).toBeNull();
  });
});
