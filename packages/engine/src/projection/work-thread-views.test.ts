import { expect, it } from 'vitest';
import { seedGuardRegistry, type EngineSnapshot, type ThreadSnapshot } from '@ui4a/shared';
import { project } from '../contract/siren';
const statuses = ['open', 'paused', 'completed', 'archived'] as const;
const threads = Object.fromEntries(
  statuses.map((status) => [
    status,
    {
      id: status,
      owner: 'user:a',
      goal: { text: status, source: 'source:a' },
      status,
      references: { context: [], active: [], approval: [], event: [] },
      recentEventSeqs: [],
    } satisfies ThreadSnapshot,
  ]),
);
const snapshot: EngineSnapshot = { instances: {}, collections: {}, threads };
it('current work includes open and paused without requiring a delegation', () => {
  const entity = project(snapshot, 'threads-current', { flows: {}, guards: seedGuardRegistry });
  expect(entity?.entities?.map((x) => x.properties.status)).toEqual(['open', 'paused']);
  expect(entity?.actions).toEqual([]);
});
it('historical work is separately discoverable and does not imply verified success', () => {
  const entity = project(snapshot, 'threads-history', { flows: {}, guards: seedGuardRegistry });
  expect(entity?.entities?.map((x) => x.properties.status)).toEqual(['completed', 'archived']);
  expect(
    project(snapshot, 'threads', { flows: {}, guards: seedGuardRegistry })?.links.some((x) =>
      x.href.includes('threads-history'),
    ),
  ).toBe(true);
});
it('current execution slice excludes terminal delegation history', () => {
  const runs = {
    ...snapshot,
    delegations: Object.fromEntries(
      ['running', 'completed', 'failed', 'max-steps'].map((status, i) => [
        'delegation:' + i,
        {
          id: String(i),
          goal: { verb: 'work' },
          driverKind: 'llm',
          startRel: 'items',
          principal: 'user:a',
          status,
          steps: 0,
          successes: 0,
        },
      ]),
    ),
  } as EngineSnapshot;
  expect(
    project(runs, 'delegations-current', { flows: {}, guards: seedGuardRegistry })?.entities?.map(
      (x) => x.properties.status,
    ),
  ).toEqual(['running']);
  expect(
    project(runs, 'delegations', { flows: {}, guards: seedGuardRegistry })?.entities,
  ).toHaveLength(4);
});
