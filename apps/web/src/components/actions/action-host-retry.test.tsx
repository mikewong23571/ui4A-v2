// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { EntityView } from '../entity-view';
import { MetaActions } from '../meta/renderers/common';
import { execAction } from '../exec-client';
import { execMetaAction } from '../meta/meta-client';

vi.mock('../exec-client', async (original) => ({
  ...(await original<typeof import('../exec-client')>()),
  execAction: vi.fn(),
}));
vi.mock('../meta/meta-client', async (original) => ({
  ...(await original<typeof import('../meta/meta-client')>()),
  execMetaAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it.each(['entity', 'meta'] as const)(
  '%s keeps logical retry identity across fresh host rerenders',
  async (host) => {
    const rel = host === 'meta' ? 'meta/future' : 'future:collection';
    const entity: SirenEntity = {
      class: ['future'],
      properties: { rel, version: 1 },
      links: [],
      actions: [
        {
          name: 'future-create',
          title: '创建',
          method: 'POST',
          href: host === 'meta' ? '/_meta/api/exec' : '/api/exec',
          fields: {
            type: 'object',
            properties: {
              commandId: { type: 'string', 'x-ui4a-input-owner': 'client' },
              baseVersion: { type: 'integer', 'x-ui4a-input-owner': 'client' },
              goal: { type: 'string', title: '目标' },
            },
            required: ['commandId', 'baseVersion', 'goal'],
          },
        },
      ],
    };
    const exec = vi.mocked(host === 'meta' ? execMetaAction : execAction);
    exec.mockResolvedValue({ ok: false, status: 503, layer: 'network', reason: 'response lost' });
    const viewOf = (current: SirenEntity) =>
      host === 'meta' ? (
        <MetaActions entity={current} rel={rel} scope="default" />
      ) : (
        <EntityView entity={current} rel={rel} />
      );
    const view = render(viewOf(entity));
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    fireEvent.change(screen.getByRole('textbox', { name: /目标/ }), {
      target: { value: 'same logical work' },
    });
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('response lost'));
    view.rerender(viewOf({ ...entity, properties: { ...entity.properties, version: 2 } }));
    expect((screen.getByRole('textbox', { name: /目标/ }) as HTMLInputElement).value).toBe(
      'same logical work',
    );
    fireEvent.submit(view.container.querySelector('form')!);
    await waitFor(() => expect(exec).toHaveBeenCalledTimes(2));
    const first = exec.mock.calls[0][0].params!;
    const second = exec.mock.calls[1][0].params!;
    expect(second.commandId).toBe(first.commandId);
    expect(first.baseVersion).toBe(1);
    expect(second.baseVersion).toBe(2);
  },
);
