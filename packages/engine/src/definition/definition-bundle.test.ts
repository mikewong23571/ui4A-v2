import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';

import { exportDefinitionBundle, parseDefinitionBundle } from './definition-bundle';

const flow: FlowDefinition = {
  name: 'post-status',
  title: 'Post status',
  app: 'publishing',
  initial: 'published',
  nodes: [{ name: 'published', actions: [] }],
};

const snapshot: EngineSnapshot = {
  instances: {},
  collections: {},
  applications: {
    publishing: {
      name: 'publishing',
      title: 'Publishing',
      intent: 'Publish content',
      entry: { target: 'flow:post-status', role: 'primary-task' },
    },
  },
  capabilities: {},
  definitions: {
    'post-status': { name: 'post-status', status: 'active', version: 2, definition: flow },
  },
  definitionVersions: { 'post-status': { 2: flow } },
};

describe('Application definition Bundle export', () => {
  it('round-trips canonically without runtime facts or sidecars', () => {
    const exported = exportDefinitionBundle(snapshot, 'publishing');
    const parsed = parseDefinitionBundle(exported);
    expect(parsed).toEqual(exported);
    expect(JSON.stringify(exported)).not.toMatch(/instances|session|sidecar|secret/i);
    expect(exported.applications[0]?.entry).toEqual({
      target: 'flow:post-status',
      role: 'primary-task',
    });
    expect(exported.provenance.flows).toEqual([{ name: 'post-status', version: 2 }]);
  });
});
