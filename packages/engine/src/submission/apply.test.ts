import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';

import { contentVersion } from '../contract/sitemap';
import { applyDefinitionCandidate } from './apply';

const current: FlowDefinition = {
  name: 'post-status',
  app: 'publishing',
  initial: 'published',
  nodes: [{ name: 'published', actions: [] }],
};

function snapshot(): EngineSnapshot {
  return {
    instances: {
      'meta/flow:post-status': {
        rel: 'meta/flow:post-status',
        flow: 'definition-lifecycle',
        node: 'active',
        fields: {},
      },
      'post:old': {
        rel: 'post:old',
        flow: 'post-status',
        node: 'published',
        fields: {},
        bornVersion: 1,
      },
    },
    collections: {},
    definitions: {
      'post-status': { name: 'post-status', version: 1, status: 'active', definition: current },
    },
    definitionVersions: { 'post-status': { 1: current } },
    activations: {},
  };
}

describe('atomic definition candidate apply fold', () => {
  it('moves only the active definition pointer and preserves born versions', () => {
    const next = structuredClone(current);
    next.title = 'Improved status';
    const applied = applyDefinitionCandidate(snapshot(), {
      schemaVersion: 1,
      commandId: 'approve:d1',
      name: 'post-status',
      baseVersion: 1,
      version: 2,
      activationId: 'draft-d1',
      draftId: 'd1',
      draftVersion: 2,
      payloadHash: `sha256:${'a'.repeat(64)}`,
      policyScope: 'publishing',
      artifact: contentVersion(next),
      definition: next,
      checks: [],
      requestedBy: { actor: 'agent', principal: 'user:mike' },
      decidedBy: { actor: 'human', principal: 'user:mike' },
    });
    expect(applied.definitions?.['post-status']?.version).toBe(2);
    expect(applied.definitionVersions?.['post-status']?.[1]).toEqual(current);
    expect(applied.definitionVersions?.['post-status']?.[2]).toEqual(next);
    expect(applied.instances['post:old']?.bornVersion).toBe(1);
    expect(applied.activations?.['meta/activation:draft-d1']).toMatchObject({
      status: 'approved',
      version: 2,
    });
  });

  it('fails closed on stale base or non-human approval', () => {
    const detail = {
      schemaVersion: 1 as const,
      commandId: 'approve:d1',
      name: 'post-status',
      baseVersion: 0,
      version: 1,
      activationId: 'draft-d1',
      draftId: 'd1',
      draftVersion: 1,
      payloadHash: `sha256:${'a'.repeat(64)}`,
      policyScope: 'publishing',
      artifact: contentVersion(current),
      definition: current,
      checks: [],
      requestedBy: { actor: 'agent' as const },
      decidedBy: { actor: 'human' as const },
    };
    expect(() => applyDefinitionCandidate(snapshot(), detail)).toThrow('stale');
    expect(() =>
      applyDefinitionCandidate(snapshot(), {
        ...detail,
        baseVersion: 1,
        version: 2,
        decidedBy: { actor: 'agent' },
      }),
    ).toThrow('human');
  });
});
