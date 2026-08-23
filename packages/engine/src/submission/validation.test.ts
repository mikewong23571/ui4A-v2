import { describe, expect, it } from 'vitest';

import { seedGuardRegistry, type FlowDefinition } from '@ui4a/shared';

import { mechanicalFlowDiff, validateFlowDraft } from './validation';

const base: FlowDefinition = {
  name: 'post-status',
  title: 'Post status',
  app: 'publishing',
  initial: 'published',
  nodes: [
    {
      name: 'published',
      actions: [{ name: 'archive', title: 'Archive', to: 'archived', guards: [] }],
    },
    { name: 'archived', actions: [] },
  ],
};

describe('Draft validation and diff', () => {
  it('uses parser and activation invariants with stable issues', () => {
    const invalid = validateFlowDraft({ name: 'x' }, { guards: seedGuardRegistry });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues[0]).toMatchObject({ code: 'parse-error', path: '/' });

    const valid = validateFlowDraft(base, {
      guards: seedGuardRegistry,
      applications: new Set(['publishing']),
      capabilities: new Set(),
    });
    expect(valid.valid).toBe(true);
    expect(valid.value?.name).toBe('post-status');
  });

  it('returns a canonical mechanical diff and hash', () => {
    const after = structuredClone(base);
    after.nodes[0]!.actions[0]!.guards = ['is-published'];
    const first = mechanicalFlowDiff(base, after);
    const second = mechanicalFlowDiff(structuredClone(base), structuredClone(after));
    expect(first).toEqual(second);
    expect(first.diff.changed).not.toEqual({ added: {}, deleted: {}, updated: {} });
    expect(first.hash).toMatch(/^fnv1a64:/);
  });
});
