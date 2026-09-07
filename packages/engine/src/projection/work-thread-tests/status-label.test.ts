import { expect, it } from 'vitest';
import { seedGuardRegistry, type EngineSnapshot, type FlowDefinition } from '@ui4a/shared';
import { project } from '../../contract/siren';

it('binds member state labels to the birth-pinned declaration, retaining the machine state', () => {
  const flow = (title: string): FlowDefinition => ({
    name: 'task',
    initial: 'archived',
    nodes: [{ name: 'archived', title, actions: [] }],
  });
  const snapshot: EngineSnapshot = {
    instances: {
      'task:a': { rel: 'task:a', flow: 'task', bornVersion: 1, node: 'archived', fields: {} },
    },
    collections: {},
    threads: {
      t: {
        id: 't',
        owner: 'me',
        goal: { text: 'Review', source: 'source:a' },
        status: 'open',
        recentEventSeqs: [],
        references: { context: ['task:a', 'message:m'], active: [], approval: [], event: [] },
      },
    },
  };
  const entity = project(snapshot, 'thread:t', {
    flows: { task: flow('新版本归档') },
    versions: { task: { 1: flow('已归档') } },
    guards: seedGuardRegistry,
  });
  expect(entity?.entities?.[0]?.properties).toMatchObject({
    status: 'archived',
    statusText: '已归档',
    presentation: { fields: [{ path: 'properties.statusText', title: '状态', role: 'status' }] },
  });
  expect(entity?.entities?.[1]?.properties.presentation).toMatchObject({
    fields: [{ path: 'properties.statusText', title: '状态', role: 'status' }],
  });
});
