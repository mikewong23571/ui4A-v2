// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { FlowDefinitionView } from './flow-definition-view';

const actionable: SirenEntity = {
  class: ['meta', 'flow-definition'],
  properties: { name: 'post-status', version: 1, status: 'active' },
  actions: [
    {
      name: 'revise',
      title: 'Revise',
      method: 'POST',
      href: '/_meta/api/exec',
      fields: { type: 'object', properties: {} },
    },
  ],
  links: [],
  'guard-results': [],
  entities: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('canonical Flow action scope', () => {
  it('does not manufacture a publishing lens for an unscoped action', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(actionable)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entity: actionable })));
    vi.stubGlobal('fetch', fetchMock);

    render(<FlowDefinitionView rel="meta/flow:post-status" entity={actionable} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revise' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/_meta/api/entity?rel=meta%2Fflow%3Apost-status');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/_meta/api/exec');
  });
});
