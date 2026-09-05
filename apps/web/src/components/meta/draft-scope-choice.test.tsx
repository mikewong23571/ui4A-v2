// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { MetaActions } from './renderers/common';

vi.mock('./meta-client', () => ({
  useMetaSitemap: () => ({
    state: 'ready',
    sitemap: { authorizedScopes: ['publishing', 'governance'] },
  }),
  execMetaAction: vi.fn(),
}));
afterEach(cleanup);

it('requires explicit scope selection before opening a Draft write and retains the exact target', () => {
  const entity: SirenEntity = {
    class: ['meta', 'draft'],
    properties: { rel: 'draft:review' },
    links: [],
    actions: [
      { name: 'approve', title: 'Approve', href: '/_meta/api/exec', method: 'POST', fields: {} },
    ],
  };
  const view = render(<MetaActions entity={entity} rel="draft:review" />);
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  const select = screen.getByRole('combobox', { name: '应用视角' }) as HTMLSelectElement;
  expect(select.value).toBe('');
  expect([...select.options].map((option) => option.value)).toEqual([
    '',
    'publishing',
    'governance',
  ]);
  expect(view.container.querySelector<HTMLInputElement>('input[name="rel"]')?.value).toBe(
    'draft:review',
  );
  view.rerender(<MetaActions entity={entity} rel="draft:review" scope="governance" />);
  expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
});
