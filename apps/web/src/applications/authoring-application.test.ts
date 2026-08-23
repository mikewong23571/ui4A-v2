import { describe, expect, it } from 'vitest';

import { parseApplicationBundle, parseFlowDefinition } from '@ui4a/engine';

import { installedAgentDefinitions } from './agent-definitions';
import artifact from './ui4a-walkthrough.bundle.json';

describe('built-in Agent Definition authoring specialization', () => {
  it('installs a governance-scoped author whose Prompt cannot approve or activate output', () => {
    const author = installedAgentDefinitions.find(
      ({ source }) => source.ref === 'agent-definition-author@1',
    );
    expect(author).toBeDefined();
    expect(author?.policyScopes).toEqual(['governance']);
    expect(author?.artifact.definition).toMatchObject({
      ref: 'agent-definition-author@1',
      runtimeRequirements: { class: 'agent-definition-authoring' },
      policies: { tools: { allowed: [] }, resources: { allowed: [] } },
      evaluationPolicy: {
        verifiers: expect.arrayContaining([
          'agent-definition-source-parse',
          'agent-definition-non-eval-invariants',
          'agent-definition-draft-only',
        ]),
      },
    });
    expect(JSON.stringify(author?.artifact.definition.prompt)).toMatch(
      /never approve|cannot approve/i,
    );
  });

  it('declares a governance Flow whose successful callback is explicitly bridged to Draft only', () => {
    const bundle = parseApplicationBundle(artifact);
    expect(bundle.applications).toContainEqual(
      expect.objectContaining({ name: 'governance', title: 'Agent 治理' }),
    );
    const capability = bundle.capabilities.find(({ name }) => name === 'agent-definition.author');
    expect(capability).toMatchObject({
      kind: 'effect',
      scope: { applications: ['governance'], flows: ['agent-definition-authoring'] },
      executor: {
        class: 'agent-definition-authoring',
        profile: 'authoring-default',
        agentDefinition: 'agent-definition-author@1',
      },
    });
    expect(JSON.stringify(capability)).not.toMatch(/endpoint|apiKey|model|providerId/i);

    const raw = bundle.flows.find(({ name }) => name === 'agent-definition-authoring')!;
    const flow = parseFlowDefinition(raw);
    expect(flow.app).toBe('governance');
    expect(flow.nodes.map(({ name }) => name)).toEqual([
      'request-ready',
      'authoring-running',
      'draft-ready',
      'authoring-failed',
    ]);
    const success = raw.nodes
      .find(({ name }) => name === 'authoring-running')!
      .actions.find(({ name }) => name === 'authoring-succeeded')! as unknown as Record<
      string,
      unknown
    >;
    expect(success).toMatchObject({
      internal: 'capability-callback',
      'agent-result-bridge': { kind: 'agent-definition-draft' },
    });
    expect(JSON.stringify(success)).not.toMatch(/approve|activate|direct-write/i);
  });
});
