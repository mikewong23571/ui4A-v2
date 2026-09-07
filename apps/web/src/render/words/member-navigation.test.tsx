// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberRowWord } from './member-row';
import { MemberCardWord } from './member-card';
import { MemberTableWord } from './member-table';
vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(
      'scope=notes&thread=review&returnTo=%2Fthreads&sidecar=old&filter.status=open',
    ),
}));
vi.mock('../../components/actions/action-group', () => ({ ActionGroup: () => null }));
afterEach(cleanup);
it.each([MemberRowWord, MemberCardWord, MemberTableWord])(
  'material navigation preserves explicit situation in %s',
  (Word) => {
    render(<Word label="Review material" rel="object:a" />);
    expect(screen.getByRole('link', { name: 'Review material' }).getAttribute('href')).toBe(
      '/canvas?focus=object%3Aa&scope=notes&thread=review&returnTo=%2Fthreads',
    );
  },
);
it('nested responsibility navigation retains thread context', () => {
  render(
    <MemberRowWord
      label="Group"
      rel="object:group"
      members={[
        {
          class: [],
          properties: {
            rel: 'object:decision',
            identity: 'Review decision',
            presentation: { version: 1, traits: ['human-responsibility'] },
          },
          links: [],
        },
      ]}
    />,
  );
  expect(screen.getByRole('link', { name: 'Review decision' }).getAttribute('href')).toContain(
    'thread=review',
  );
});
