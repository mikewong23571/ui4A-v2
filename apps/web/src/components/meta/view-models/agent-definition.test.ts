import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { agentDefinitionViewModel, redactMetaValue } from './agent-definition';

const definition: SirenEntity = {
  class: ['meta', 'agent-definition', 'active'],
  properties: {
    ref: 'writer@1',
    name: 'writer',
    version: 1,
    status: 'active',
    intent: 'Write grounded documents.',
    runtimeClass: 'writing-agent',
    requiredFeatures: ['structured-result'],
    contracts: { inputSchema: { type: 'object' }, outputSchema: { type: 'object' } },
    policies: {
      tools: { allowed: ['read'] },
      resources: { allowed: ['source-set'] },
      artifacts: { allowedMediaTypes: ['text/markdown'] },
    },
    evaluationPolicy: { minimumScore: 0.8, verifiers: ['citations'] },
    evaluation: { passed: true, score: 1 },
    prompt: {
      blocks: [
        {
          id: 'authority',
          role: 'system',
          purpose: 'authority',
          sealed: true,
          literal: 'Bounded.',
        },
        {
          id: 'task',
          role: 'user',
          purpose: 'task-data',
          binding: { source: 'task', pointer: '/brief', encoding: 'json-delimited' },
        },
      ],
    },
    hashes: { flattened: 'sha256:abc', prompt: 'sha256:def' },
  },
  actions: [],
  links: [],
  'guard-results': [],
};

describe('Agent Definition view model', () => {
  it('separates sealed authority, typed binding and deployment requirements', () => {
    expect(agentDefinitionViewModel(definition)).toMatchObject({
      ref: 'writer@1',
      authority: [{ id: 'authority', sealed: true }],
      bindings: [{ id: 'task', source: 'task', pointer: '/brief' }],
      runtime: { class: 'writing-agent', features: ['structured-result'] },
      tools: ['read'],
      resources: ['source-set'],
      evaluation: { passed: true, score: 1 },
    });
  });

  it('redacts provider/deployment secrets recursively before generic/raw disclosure', () => {
    expect(
      redactMetaValue({
        apiKey: 'secret',
        endpoint: 'https://provider',
        nested: { token: 'x', ok: 1 },
      }),
    ).toEqual({
      apiKey: '[redacted]',
      endpoint: '[redacted]',
      nested: { token: '[redacted]', ok: 1 },
    });
  });
});
