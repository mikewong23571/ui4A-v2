import { describe, expect, it } from 'vitest';

import { parseApplicationBundle, parseFlowDefinition } from '@ui4a/engine';

import { installedAgentDefinitions } from './agent-definitions';
import artifact from './ui4a-walkthrough.bundle.json';

describe('built-in Writing specialization and editorial Application', () => {
  it('installs parent-first exact Agent Definition versions in explicit policy scopes', () => {
    expect(
      installedAgentDefinitions.map(({ source, policyScopes }) => ({
        ref: source.ref,
        policyScopes,
      })),
    ).toEqual([
      { ref: 'base-agent@1', policyScopes: ['development', 'editorial'] },
      { ref: 'coding-agent@1', policyScopes: ['development'] },
      { ref: 'writing-agent@1', policyScopes: ['editorial'] },
    ]);

    const writing = installedAgentDefinitions.at(-1)!;
    expect(writing.artifact.definition).toMatchObject({
      ref: 'writing-agent@1',
      runtimeRequirements: {
        class: 'document-agent',
        features: expect.arrayContaining(['document-workspace', 'artifact-write']),
      },
      policies: {
        tools: {
          allowed: expect.arrayContaining(['source-read', 'artifact-write', 'artifact-hash']),
        },
        resources: { allowed: ['document-workspace', 'writing-sources'] },
      },
      evaluationPolicy: {
        verifiers: expect.arrayContaining([
          'writing-result-schema',
          'citation-coverage',
          'markdown-render',
          'forbidden-writing-effects',
        ]),
      },
    });
  });

  it('declares an editorial brief-to-review Flow whose human acceptance never publishes', () => {
    const bundle = parseApplicationBundle(artifact);
    expect(bundle.applications).toContainEqual(
      expect.objectContaining({ name: 'editorial', title: '编辑写作' }),
    );
    const capability = bundle.capabilities.find(({ name }) => name === 'writing.compose');
    expect(capability).toMatchObject({
      kind: 'effect',
      scope: { applications: ['editorial'], flows: ['writing-request'] },
      executor: {
        class: 'document-agent',
        profile: 'editorial-default',
        agentDefinition: 'writing-agent@1',
      },
    });
    expect(JSON.stringify(capability)).not.toMatch(/provider|endpoint|apiKey|model/i);

    const flow = parseFlowDefinition(bundle.flows.find(({ name }) => name === 'writing-request')!);
    expect(flow.app).toBe('editorial');
    expect(flow.nodes.map(({ name }) => name)).toEqual([
      'brief-draft',
      'writing-running',
      'review-ready',
      'writing-failed',
      'accepted',
      'rejected',
    ]);
    const callbacks = flow.nodes.find(({ name }) => name === 'writing-running')!.actions;
    expect(callbacks.every(({ internal }) => internal === 'capability-callback')).toBe(true);
    const reviewActions = flow.nodes.find(({ name }) => name === 'review-ready')!.actions;
    expect(reviewActions.map(({ name }) => name)).toEqual([
      'accept-writing-result',
      'reject-writing-result',
    ]);
    expect(reviewActions.every(({ guards }) => guards?.includes('actor-is-human'))).toBe(true);
    expect(JSON.stringify(reviewActions)).not.toMatch(/publish|append|activate/i);
  });
});
