// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import ApplicationsPage, { metadata } from './page';
vi.mock('@/components/applications/application-directory', () => ({
  ApplicationDirectory: () => <div data-testid="application-directory" />,
}));
afterEach(cleanup);
it('hosts the one shared directory without introducing another main or app-specific page', () => {
  const { container } = render(<ApplicationsPage />);
  expect(screen.getByTestId('application-directory')).toBeTruthy();
  expect(container.querySelector('main')).toBeNull();
  expect(metadata.title).toBe('应用 · UI4A');
});
