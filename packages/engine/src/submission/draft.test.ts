import { describe, expect, it } from 'vitest';

import {
  applyDraftCommand,
  createDraftSnapshot,
  foldDraftEvents,
  inspectJsonBudget,
  payloadFingerprint,
} from './draft';

const provenance = {
  actor: 'agent' as const,
  principal: 'user:mike',
  commandId: 'command:create',
  sources: ['goal:1'],
};

describe('Draft kernel', () => {
  it('stores invalid payload as immutable v1 without entering Active truth', () => {
    const result = applyDraftCommand(createDraftSnapshot(), {
      kind: 'create',
      eventId: 'event:1',
      commandId: 'command:create',
      draftId: 'd1',
      owner: 'user:mike',
      policyScope: 'publishing',
      draftKind: 'flow-definition',
      target: 'post-status',
      baseVersion: '1',
      payloadHash: payloadFingerprint({ name: 'post-status' }),
      schemaRef: 'ui4a://flow-definition/v1',
      provenance,
      validation: {
        valid: false,
        issues: [{ code: 'schema', path: '/nodes', message: 'required' }],
      },
    });
    expect(result.snapshot.drafts.d1).toMatchObject({ status: 'invalid', activeVersion: 1 });
    expect(foldDraftEvents(result.events)).toEqual(result.snapshot);
  });

  it('enforces CAS, command idempotency and terminal immutability', () => {
    let result = applyDraftCommand(createDraftSnapshot(), {
      kind: 'create',
      eventId: 'event:1',
      commandId: 'command:create',
      draftId: 'd1',
      owner: 'user:mike',
      policyScope: 'publishing',
      draftKind: 'flow-definition',
      payloadHash: payloadFingerprint({ name: 'x' }),
      schemaRef: 'ui4a://flow-definition/v1',
      provenance,
      validation: { valid: false, issues: [] },
    });
    result = applyDraftCommand(result.snapshot, {
      kind: 'revise',
      eventId: 'event:2',
      commandId: 'command:revise',
      draftId: 'd1',
      baseVersion: 1,
      payloadHash: payloadFingerprint({ name: 'x', nodes: [] }),
      schemaRef: 'ui4a://flow-definition/v1',
      provenance: { ...provenance, commandId: 'command:revise' },
      validation: { valid: true, issues: [] },
    });
    expect(result.snapshot.drafts.d1?.activeVersion).toBe(2);
    const retry = applyDraftCommand(result.snapshot, {
      kind: 'revise',
      eventId: 'event:retry',
      commandId: 'command:revise',
      draftId: 'd1',
      baseVersion: 1,
      payloadHash: 'ignored',
      schemaRef: 'ignored',
      provenance,
      validation: { valid: false, issues: [] },
    });
    expect(retry.events).toHaveLength(0);
    expect(() =>
      applyDraftCommand(result.snapshot, {
        kind: 'revise',
        eventId: 'event:3',
        commandId: 'command:conflict',
        draftId: 'd1',
        baseVersion: 1,
        payloadHash: 'hash',
        schemaRef: 'schema',
        provenance,
        validation: { valid: false, issues: [] },
      }),
    ).toThrow('conflict');
  });

  it('transitions ready through submit/accept and forbids later mutation', () => {
    let state = applyDraftCommand(createDraftSnapshot(), {
      kind: 'create',
      eventId: 'e1',
      commandId: 'c1',
      draftId: 'd1',
      owner: 'user:mike',
      policyScope: 'publishing',
      draftKind: 'flow-definition',
      payloadHash: 'sha256:a',
      schemaRef: 'schema',
      provenance,
      validation: { valid: true, issues: [] },
    }).snapshot;
    state = applyDraftCommand(state, {
      kind: 'submit',
      eventId: 'e2',
      commandId: 'c2',
      draftId: 'd1',
      activeVersion: 1,
      activation: 'meta/activation:draft-d1',
    }).snapshot;
    state = applyDraftCommand(state, {
      kind: 'accept',
      eventId: 'e3',
      commandId: 'c3',
      draftId: 'd1',
      activeVersion: 1,
    }).snapshot;
    expect(state.drafts.d1?.status).toBe('accepted');
    expect(() =>
      applyDraftCommand(state, {
        kind: 'abandon',
        eventId: 'e4',
        commandId: 'c4',
        draftId: 'd1',
        activeVersion: 1,
      }),
    ).toThrow('terminal');
  });

  it('bounds depth, node count and byte length before persistence', () => {
    expect(inspectJsonBudget({ value: ['ok'] })).toMatchObject({ valid: true });
    expect(inspectJsonBudget({ value: { nested: { too: 'deep' } }, maxDepth: 1 }).valid).toBe(
      false,
    );
    expect(inspectJsonBudget({ value: 'x'.repeat(20), maxBytes: 5 }).valid).toBe(false);
  });
});

