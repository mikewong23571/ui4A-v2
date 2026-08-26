// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({
  route: '/canvas?mode=raw&scope=publishing&thread=release-1&focus=post%3Aone',
  observation: {
    site: 'workstation',
    scope: 'publishing',
    thread: 'release-1',
    focus: 'post:one' as const,
  },
}));

vi.mock('@/presence/location', () => ({
  useLocationObservation: () => location,
}));

import { SituationBar } from './situation-bar';

afterEach(cleanup);

describe('SituationBar', () => {
  it('shows the exact site/scope/thread/focus URL observation as declared context', () => {
    render(<SituationBar />);

    expect(screen.getByRole('region', { name: '声明的处境' }).textContent).toContain(
      '你在 URL 中声明的处境',
    );
    expect(screen.getByTestId('situation-site').textContent).toBe('workstation');
    expect(screen.getByTestId('situation-scope').textContent).toBe('publishing');
    expect(screen.getByTestId('situation-thread').textContent).toBe('release-1');
    expect(screen.getByTestId('situation-focus').textContent).toBe('post:one');
    expect(screen.getByText(/不代表已授权/)).toBeTruthy();
    expect(screen.queryByText(/granted/i)).toBeNull();
  });

  it('preserves unrelated query fields for scope changes, scope clearing, and thread exit', () => {
    render(<SituationBar />);

    expect(screen.getByRole('link', { name: '退出工作线' }).getAttribute('href')).toBe(
      '/canvas?mode=raw&scope=publishing&focus=post%3Aone',
    );

    fireEvent.click(screen.getByText('调整声明'));
    expect(screen.getByRole('link', { name: '清除 scope' }).getAttribute('href')).toBe(
      '/canvas?mode=raw&thread=release-1&focus=post%3Aone',
    );
    fireEvent.change(screen.getByLabelText('声明 scope'), {
      target: { value: 'development' },
    });
    expect(screen.getByRole('link', { name: '应用 scope' }).getAttribute('href')).toBe(
      '/canvas?mode=raw&scope=development&thread=release-1&focus=post%3Aone',
    );
  });

  it('annotates every interactive control for the I3 zero-allowlist probe', () => {
    const { container } = render(<SituationBar />);
    fireEvent.click(screen.getByText('调整声明'));
    const controls = container.querySelectorAll('a, button, summary, input');
    expect(controls.length).toBeGreaterThan(0);
    expect(
      [...controls].filter(
        (control) => !control.hasAttribute('data-nav') && !control.hasAttribute('data-action'),
      ),
    ).toEqual([]);
  });
});
