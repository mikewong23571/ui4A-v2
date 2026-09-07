import { expect, it } from 'vitest';
import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';
import { canonicalJson, contentVersion } from '../contract/sitemap';
import { fold, type LogEvent } from '../projection/fold';
import { applyDefinitionCandidate, type DefinitionCandidateAppliedDetail } from './apply';

const definition: FlowDefinition = {
  name: 'task',
  initial: 'open',
  nodes: [{ name: 'open', actions: [] }],
};
const rel = 'meta/flow:task';
const candidate = { ...definition, title: 'Approved candidate' };
const detail: DefinitionCandidateAppliedDetail = {
  schemaVersion: 1,
  commandId: 'human:approve',
  name: 'task',
  baseVersion: 1,
  version: 2,
  activationId: 'draft:review',
  draftId: 'review',
  draftVersion: 1,
  payloadHash: `sha256:${'a'.repeat(64)}`,
  policyScope: 'default',
  artifact: contentVersion(candidate),
  definition: candidate,
  checks: [],
  requestedBy: { actor: 'agent' },
  decidedBy: { actor: 'human' },
};
const prefix: LogEvent[] = [
  {
    seq: 1,
    kind: 'definition-seeded',
    detail: { name: 'task', version: 1, status: 'active', definition },
  },
  { seq: 2, kind: 'action-executed', rel, action: 'revise', actor: 'human', params: {} },
  { seq: 3, kind: 'definition-revised', rel, detail: { name: 'task' } },
];
const before = () => fold(prefix, { flows: {} });

it('hands off only an unchanged revision into the exact human-approved candidate and replays deterministically', () => {
  const source = before();
  const original = canonicalJson(source);
  const applied = applyDefinitionCandidate(source, detail);
  expect(applied.instances[rel]?.node).toBe('active');
  expect(applied.definitions?.task).toMatchObject({
    status: 'active',
    version: 2,
    definition: candidate,
  });
  expect(applied.definitionVersions?.task?.[1]).toEqual(definition);
  expect(canonicalJson(source)).toBe(original);
  const suffix: LogEvent[] = [{ seq: 4, kind: 'definition-candidate-applied', detail }];
  const all = [...prefix, ...suffix];
  expect(fold(all, { flows: {} })).toEqual(applied);
  expect(fold(all, { flows: {} })).toEqual(fold(all, { flows: {} }));
  expect(fold(suffix, { flows: {} }, before())).toEqual(applied);
  expect(() => applyDefinitionCandidate(applied, detail)).toThrow('stale');
});

const changes: Array<[string, (snapshot: EngineSnapshot) => void]> = [
  [
    'edited',
    (snapshot) => {
      snapshot.definitions!.task!.definition = { ...definition, title: 'Unapproved edit' };
    },
  ],
  [
    'missing base',
    (snapshot) => {
      delete snapshot.definitionVersions!.task![1];
    },
  ],
  [
    'wrong bornBy',
    (snapshot) => {
      snapshot.definitions!.task!.bornBy = 0;
    },
  ],
  [
    'no bornBy',
    (snapshot) => {
      delete snapshot.definitions!.task!.bornBy;
    },
  ],
  ...(['validating', 'pending-approval', 'rejected', 'deprecated'] as const).map(
    (status): [string, (snapshot: EngineSnapshot) => void] => [
      status,
      (snapshot) => {
        snapshot.instances[rel]!.node = status;
        snapshot.definitions!.task!.status = status === 'validating' ? 'draft' : status;
      },
    ],
  ),
  [
    'registry mismatch',
    (snapshot) => {
      snapshot.definitions!.task!.status = 'active';
    },
  ],
  [
    'another pending approval',
    (snapshot) => {
      snapshot.activations = {
        pending: {
          id: 'pending',
          flow: 'task',
          status: 'pending-approval',
          version: 2,
          artifact: contentVersion(definition),
          definition,
          checks: [],
          requestedBy: { actor: 'human' },
        },
      };
    },
  ],
];
it.each(changes)('does not hand off %s', (_name, change) => {
  const source = before();
  change(source);
  expect(() => applyDefinitionCandidate(source, detail)).toThrow('lifecycle is not active');
});
it('never turns agent approval into human approval during a handoff', () => {
  expect(() =>
    applyDefinitionCandidate(before(), { ...detail, decidedBy: { actor: 'agent' } }),
  ).toThrow('human');
});
