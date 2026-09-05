import { describe, expect, it } from 'vitest';

import type { ActionDefinition, FlowDefinition } from '../core/types';
import { flowRegistry } from '../core/fixtures';
import { toSirenAction } from '../contract/siren/build';
import { judge } from './judge';

const field = { name: 'title', type: 'text', required: true } as const;

describe('Siren action parameter contract and judgment agree', () => {
  it.each([false, true, undefined])('honors collect-node-fields=%s in both readers', (collect) => {
    const action: ActionDefinition = {
      name: 'finish',
      title: 'Finish',
      to: 'done',
      guards: [],
      fields: [],
      ...(collect === undefined ? {} : { 'collect-node-fields': collect }),
      effect: [{ type: 'transition', to: 'done' }],
    };
    const flow: FlowDefinition = {
      name: 'review',
      initial: 'open',
      nodes: [
        { name: 'open', fields: [field], actions: [action] },
        { name: 'done', actions: [] },
      ],
    };
    const snapshot = {
      instances: { 'review:one': { rel: 'review:one', flow: 'review', node: 'open', fields: {} } },
      collections: {},
    };
    const deps = { flows: flowRegistry(flow), guards: {} };
    const result = judge(
      { rel: 'review:one', action: 'finish', params: collect === false ? {} : { title: 'Done' } },
      snapshot,
      deps,
    );
    expect(result.kind).toBe('accepted');
    if (result.kind === 'accepted')
      expect(result.schema).toEqual(toSirenAction(action, [field], undefined).fields);
    expect(
      judge(
        {
          rel: 'review:one',
          action: 'finish',
          params: collect === false ? { title: 'extra' } : {},
        },
        snapshot,
        deps,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
  });
});
