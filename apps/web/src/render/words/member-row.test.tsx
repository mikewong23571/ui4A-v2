// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberRowWord } from './member-row';
vi.mock('../../components/actions/action-group', () => ({
  ActionGroup: ({ posture }: { posture?: string }) => (
    <span data-testid="posture">{posture ?? 'expanded'}</span>
  ),
}));
vi.mock('./member-card', () => ({
  MemberCardWord: () => <div data-testid="decision">Decision</div>,
}));
afterEach(cleanup);
it('ordinary actionable work is a summary with secondary actions', () => {
  render(
    <MemberRowWord
      label="My goal"
      rel="object:a"
      actions={[{ name: 'manage' }]}
      cognitive={{ version: 1, traits: ['work-queue'] }}
    />,
  );
  expect(screen.getByRole('link', { name: 'My goal' })).toBeTruthy();
  expect(screen.getByTestId('posture').textContent).toBe('disclosure');
  expect(screen.queryByTestId('decision')).toBeNull();
});
it('a declared leaf responsibility retains its decision card', () => {
  render(
    <MemberRowWord
      label="Decide"
      rel="object:a"
      actions={[{ name: 'decide' }]}
      cognitive={{ version: 1, traits: ['human-responsibility'] }}
    />,
  );
  expect(screen.getByTestId('decision')).toBeTruthy();
});
it('group lifecycle is not a decision, nested responsibility remains prominent', () => {
  render(
    <MemberRowWord
      label="Work"
      rel="object:a"
      actions={[{ name: 'manage' }]}
      cognitive={{ version: 1, traits: ['human-responsibility'], groupRole: 'responsibility' }}
      members={[
        {
          class: [],
          properties: {
            rel: 'object:b',
            identity: 'Choose result',
            presentation: { version: 1, traits: ['human-responsibility'] },
          },
          actions: [{ name: 'decide' }],
          links: [],
        },
      ]}
    />,
  );
  expect(screen.getByRole('link', { name: 'Choose result' })).toBeTruthy();
  expect(screen.getByTestId('posture').textContent).toBe('disclosure');
  expect(screen.queryByTestId('decision')).toBeNull();
});

it('preserves declared overview values for ordinary rows without showing undeclared fields', () => {
  render(
    <MemberRowWord
      label="Work"
      rel="object:a"
      fields={{ due: 'Friday', cost: 7, secret: 'NO' }}
      presentations={[
        { path: 'properties.fields.due', title: 'Due', role: 'metadata', overview: true },
        { path: 'properties.fields.cost', title: 'Cost', role: 'metadata', overview: true },
      ]}
    />,
  );
  expect(screen.getByText('Friday')).toBeTruthy();
  expect(screen.getByText('7')).toBeTruthy();
  expect(screen.queryByText('NO')).toBeNull();
});
it.each([[], [{ class: [], properties: { rel: 'evidence:a' }, actions: [], links: [] }]])(
  'a leaf responsibility remains a decision with children %j',
  (...children) => {
    render(
      <MemberRowWord
        label="Decide"
        rel="object:a"
        actions={[{ name: 'decide' }]}
        cognitive={{ version: 1, traits: ['human-responsibility'] }}
        members={children}
      />,
    );
    expect(screen.getByTestId('decision')).toBeTruthy();
  },
);
it.each([
  { version: 99, traits: ['human-responsibility'] },
  { version: 1, traits: ['future-role'] },
])('unknown cognition remains readable %j', (cognitive) => {
  render(
    <MemberRowWord
      label="Future"
      rel="object:a"
      cognitive={cognitive}
      actions={[{ name: 'manage' }]}
    />,
  );
  expect(screen.getByRole('link', { name: 'Future' })).toBeTruthy();
  expect(screen.queryByTestId('decision')).toBeNull();
});
it('finds nested responsibilities independently of evidence children or available actions', () => {
  render(
    <MemberRowWord
      label="Group"
      rel="object:group"
      cognitive={{ version: 1, groupRole: 'responsibility' }}
      members={[
        {
          class: [],
          properties: {
            rel: 'object:pending',
            identity: 'Needs a decision',
            presentation: { version: 1, traits: ['human-responsibility'] },
          },
          actions: [],
          links: [],
          entities: [{ class: [], properties: { rel: 'evidence:a' }, actions: [], links: [] }],
        },
      ]}
    />,
  );
  expect(screen.getByRole('link', { name: 'Needs a decision' })).toBeTruthy();
});
