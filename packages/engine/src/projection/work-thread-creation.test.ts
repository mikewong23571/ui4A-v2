import { describe, expect, it } from 'vitest';
import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';
import { callerActionSchema } from '../contract/action-input-ownership';
import { project } from '../contract/siren';
import { applyThreadEvent } from './fold/apply-thread';
import { executeThreadCommand } from './work-thread-command';

const empty: EngineSnapshot = { instances: {}, collections: {} };
const deps = { flows: {}, guards: seedGuardRegistry };
const request = {
  rel: 'threads',
  action: 'create',
  principal: 'user:mike',
  actor: 'human' as const,
  channel: 'http',
  params: { commandId: 'one-goal', goal: '  Preserve my exact\n goal  ' },
};

describe('goal-only work creation', () => {
  it('declares a single caller goal and a client retry key', () => {
    const action = project(empty, 'threads', deps)!.actions[0]!;
    expect(callerActionSchema(action.fields).required).toEqual(['goal']);
    expect(action.fields.required).toEqual(['commandId', 'goal']);
  });
  it.each(['human', 'agent'] as const)(
    'records original input atomically with %s identity',
    (actor) => {
      const first = executeThreadCommand({ ...request, actor }, empty);
      expect(first.kind).toBe('accepted');
      if (first.kind !== 'accepted') throw new Error('expected accepted');
      expect(first.event).toMatchObject({
        actor,
        principal: request.principal,
        detail: {
          owner: request.principal,
          goal: { text: request.params.goal, source: 'thread-input:one-goal' },
        },
      });
      const replay = applyThreadEvent(empty, { ...first.event, seq: 1 });
      expect(replay).toEqual(first.snapshot);
      expect(project(replay, 'thread-input:one-goal', deps)).toMatchObject({
        properties: {
          text: request.params.goal,
          owner: request.principal,
          title: '创建时的目标原文',
        },
        actions: [],
      });
      expect(project(replay, 'thread:one-goal', deps)?.links).toContainEqual({
        rel: ['source'],
        href: '/api/entity?rel=thread-input:one-goal',
        title: '创建时的目标原文',
      });
      expect(executeThreadCommand(request, replay)).toMatchObject({
        kind: 'replayed',
        entityRel: 'thread:one-goal',
      });
    },
  );
  it('does not reopen finished work on retry and keeps original input readable', () => {
    const first = executeThreadCommand(request, empty);
    if (first.kind !== 'accepted') throw new Error('expected accepted');
    const archived = executeThreadCommand(
      { rel: 'thread:one-goal', action: 'archive', principal: request.principal },
      first.snapshot,
    );
    if (archived.kind !== 'accepted') throw new Error('expected accepted');
    const retried = executeThreadCommand(request, archived.snapshot);
    expect(retried).toMatchObject({
      kind: 'replayed',
      snapshot: { threads: { 'one-goal': { status: 'archived' } } },
    });
    expect(project(archived.snapshot, 'thread-input:one-goal', deps)?.properties.text).toBe(
      request.params.goal,
    );
    expect(project(empty, 'thread-input:constructor', deps)).toBeUndefined();
  });
  it('rejects a changed payload or owner for a previously accepted key before schema', () => {
    const first = executeThreadCommand(request, empty);
    if (first.kind !== 'accepted') throw new Error('expected accepted');
    for (const input of [
      { ...request, params: { commandId: 'one-goal', goal: 'changed', extra: true } },
      { ...request, principal: 'user:other' },
    ])
      expect(executeThreadCommand(input, first.snapshot)).toMatchObject({
        kind: 'rejected',
        layer: 'guard-failed',
      });
    expect(
      executeThreadCommand(
        { ...request, params: { ...request.params, forged: true } },
        first.snapshot,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
  });
  it.each([
    { commandId: 'ok', goal: 'x', goalSource: 'message:invented' },
    { commandId: 'not a key', goal: 'x' },
    { commandId: 'ok', goal: ' '.repeat(3) },
    { commandId: 'ok', goal: 'x'.repeat(2049) },
    { goal: 'x' },
  ])('rejects invalid creation inputs without creating a source: %j', (params) => {
    expect(executeThreadCommand({ ...request, params }, empty)).toMatchObject({
      kind: 'rejected',
      layer: 'schema-invalid',
    });
    expect(project(empty, 'thread-input:ok', deps)).toBeUndefined();
  });
});
