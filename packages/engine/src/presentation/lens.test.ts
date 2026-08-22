import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { PRESENTATION_SITUATION_VERSION, type DataLens, type RenderSituation } from '@ui4a/shared';

import {
  resolveAuthorizedContractGraph,
  type ContractGraphEdgeReference,
  type ContractGraphResolverDependencies,
} from './index';

interface TestEntity {
  title: string;
  count?: string;
  edges: ContractGraphEdgeReference[];
}

function situation(
  lens: DataLens,
  roots = ['entity:root'],
  budget = { maxDepth: 4, maxNodes: 16 },
): RenderSituation {
  return {
    schemaVersion: PRESENTATION_SITUATION_VERSION,
    roots: roots.map((rel) => ({ rel })),
    intent: 'inspect authorized graph',
    lens,
    audience: {
      principal: 'user:mike',
      policyScope: 'own-content',
    },
    budget,
  };
}

function dependencies(
  entities: Readonly<Record<string, TestEntity>>,
  authorized: (targetRel: string) => boolean = () => true,
): ContractGraphResolverDependencies<TestEntity> {
  return {
    authorize: async ({ targetRel }) => authorized(targetRel),
    fetch: async (rel) => entities[rel],
    enumerateEdges: ({ value }) => value.edges,
  };
}

describe('resolveAuthorizedContractGraph', () => {
  it('reauthorizes a direct root and self never traverses its edges', async () => {
    const authorize = vi.fn(async () => true);
    const enumerateEdges = vi.fn(() => [
      { kind: 'relation' as const, relation: 'related', targetRel: 'entity:other' },
    ]);
    const result = await resolveAuthorizedContractGraph(situation({ kind: 'self' }), {
      authorize,
      fetch: async () => ({ title: 'Root', edges: [] }),
      enumerateEdges,
    });

    expect(result).toEqual({
      roots: ['entity:root'],
      nodes: [{ rel: 'entity:root', depth: 0 }],
      edges: [],
      truncations: [],
    });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'root',
        targetRel: 'entity:root',
        audience: expect.objectContaining({ principal: 'user:mike' }),
      }),
    );
    expect(enumerateEdges).not.toHaveBeenCalled();
  });

  it('filters collection members per edge without leaking denied identity, fields or count', async () => {
    const entities = {
      'collection:posts': {
        title: 'Posts',
        edges: [
          { kind: 'member' as const, targetRel: 'post:visible' },
          { kind: 'member' as const, targetRel: 'post:SECRET_REL' },
          { kind: 'relation' as const, relation: 'owner', targetRel: 'user:ignored' },
        ],
      },
      'post:visible': { title: 'Visible post', edges: [] },
      'post:SECRET_REL': {
        title: 'SECRET_TITLE',
        count: 'SECRET_COUNT',
        edges: [],
      },
      'user:ignored': { title: 'Not selected by the lens', edges: [] },
    };
    const deps = dependencies(entities, (rel) => rel !== 'post:SECRET_REL');
    const authorize = vi.spyOn(deps, 'authorize');

    const result = await resolveAuthorizedContractGraph(
      situation({ kind: 'members' }, ['collection:posts']),
      deps,
    );

    expect(result.roots).toEqual(['collection:posts']);
    expect(result.nodes.map(({ rel }) => rel)).toEqual(['collection:posts', 'post:visible']);
    expect(result.edges).toEqual([
      { kind: 'member', sourceRel: 'collection:posts', targetRel: 'post:visible' },
    ]);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(authorize).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetRel: 'user:ignored' }),
    );
    expect(JSON.stringify(result)).not.toMatch(/SECRET_REL|SECRET_TITLE|SECRET_COUNT/);
    expect(JSON.stringify(result)).not.toMatch(/unauthorized|denied|hidden|placeholder/i);
  });

  it('follows only named relations for one hop and authorizes each selected edge', async () => {
    const entities = {
      'artifact:summary': {
        title: 'Summary',
        edges: [
          { kind: 'relation' as const, relation: 'source', targetRel: 'post:visible' },
          { kind: 'relation' as const, relation: 'source', targetRel: 'post:SECRET_REL' },
          { kind: 'relation' as const, relation: 'audit', targetRel: 'audit:ignored' },
        ],
      },
      'post:visible': {
        title: 'Visible post',
        edges: [
          { kind: 'relation' as const, relation: 'source', targetRel: 'post:nested-ignored' },
        ],
      },
      'post:SECRET_REL': { title: 'SECRET_TITLE', edges: [] },
      'audit:ignored': { title: 'Ignored', edges: [] },
      'post:nested-ignored': { title: 'Nested ignored', edges: [] },
    };
    const deps = dependencies(entities, (rel) => rel !== 'post:SECRET_REL');
    const authorize = vi.spyOn(deps, 'authorize');

    const result = await resolveAuthorizedContractGraph(
      situation({ kind: 'relations', relations: ['source'] }, ['artifact:summary']),
      deps,
    );

    expect(result.nodes.map(({ rel }) => rel)).toEqual(['artifact:summary', 'post:visible']);
    expect(result.edges).toEqual([
      {
        kind: 'relation',
        relation: 'source',
        sourceRel: 'artifact:summary',
        targetRel: 'post:visible',
      },
    ]);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(authorize).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetRel: 'audit:ignored' }),
    );
    expect(authorize).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetRel: 'post:nested-ignored' }),
    );
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('resolves bounded nested graphs, preserves cycles and emits target-free truncation receipts', async () => {
    const entities = {
      'entity:root': {
        title: 'Root',
        edges: [{ kind: 'relation' as const, relation: 'next', targetRel: 'entity:child' }],
      },
      'entity:child': {
        title: 'Child',
        edges: [
          { kind: 'relation' as const, relation: 'next', targetRel: 'entity:root' },
          { kind: 'relation' as const, relation: 'next', targetRel: 'entity:SECRET_DEEP' },
        ],
      },
      'entity:SECRET_DEEP': { title: 'SECRET_DEEP_TITLE', edges: [] },
    };
    const fetch = vi.fn(async (rel: string) => entities[rel as keyof typeof entities]);

    const result = await resolveAuthorizedContractGraph(
      situation({ kind: 'graph', relations: ['next'] }, undefined, {
        maxDepth: 1,
        maxNodes: 8,
      }),
      { ...dependencies(entities), fetch },
    );

    expect(result.nodes.map(({ rel }) => rel)).toEqual(['entity:root', 'entity:child']);
    expect(result.edges).toContainEqual({
      kind: 'relation',
      relation: 'next',
      sourceRel: 'entity:child',
      targetRel: 'entity:root',
    });
    expect(result.truncations).toEqual([
      {
        sourceRel: 'entity:child',
        reason: 'max-depth',
        kind: 'relation',
        relation: 'next',
      },
    ]);
    expect(fetch).not.toHaveBeenCalledWith('entity:SECRET_DEEP');
    expect(JSON.stringify(result)).not.toContain('SECRET_DEEP');
  });

  it('enforces maxNodes before fetching an authorized overflow target', async () => {
    const entities = {
      'entity:root': {
        title: 'Root',
        edges: [
          { kind: 'relation' as const, relation: 'next', targetRel: 'entity:first' },
          { kind: 'relation' as const, relation: 'next', targetRel: 'entity:OVERFLOW' },
        ],
      },
      'entity:first': { title: 'First', edges: [] },
      'entity:OVERFLOW': { title: 'OVERFLOW_TITLE', edges: [] },
    };
    const fetch = vi.fn(async (rel: string) => entities[rel as keyof typeof entities]);

    const result = await resolveAuthorizedContractGraph(
      situation({ kind: 'graph', relations: ['next'] }, undefined, {
        maxDepth: 4,
        maxNodes: 2,
      }),
      { ...dependencies(entities), fetch },
    );

    expect(result.nodes.map(({ rel }) => rel)).toEqual(['entity:root', 'entity:first']);
    expect(result.truncations).toEqual([
      {
        sourceRel: 'entity:root',
        reason: 'max-nodes',
        kind: 'relation',
        relation: 'next',
      },
    ]);
    expect(fetch).not.toHaveBeenCalledWith('entity:OVERFLOW');
    expect(JSON.stringify(result)).not.toContain('OVERFLOW');
  });

  it('supports explicit selection and bounded flow parts without accidental graph expansion', async () => {
    const entities = {
      'flow:one': {
        title: 'One',
        edges: [
          { kind: 'flow' as const, part: 'current-node' as const, targetRel: 'node:one' },
          { kind: 'flow' as const, part: 'history' as const, targetRel: 'history:one' },
        ],
      },
      'flow:two': { title: 'Two', edges: [] },
      'node:one': {
        title: 'Node one',
        edges: [{ kind: 'flow' as const, part: 'current-node' as const, targetRel: 'node:nested' }],
      },
      'history:one': { title: 'History', edges: [] },
      'node:nested': { title: 'Must not expand', edges: [] },
    };

    const selected = await resolveAuthorizedContractGraph(
      situation({ kind: 'selection' }, ['flow:one', 'flow:two']),
      dependencies(entities),
    );
    expect(selected.roots).toEqual(['flow:one', 'flow:two']);
    expect(selected.nodes.map(({ rel }) => rel)).toEqual(['flow:one', 'flow:two']);
    expect(selected.edges).toEqual([]);

    const flow = await resolveAuthorizedContractGraph(
      situation({ kind: 'flow', include: ['current-node'] }, ['flow:one']),
      dependencies(entities),
    );
    expect(flow.nodes.map(({ rel }) => rel)).toEqual(['flow:one', 'node:one']);
    expect(flow.edges).toEqual([
      {
        kind: 'flow',
        part: 'current-node',
        sourceRel: 'flow:one',
        targetRel: 'node:one',
      },
    ]);
  });

  it('fails closed when authorization or fetching rejects and does not create failure placeholders', async () => {
    const result = await resolveAuthorizedContractGraph(
      situation({ kind: 'selection' }, ['entity:denied', 'entity:unavailable']),
      {
        authorize: async ({ targetRel }) => {
          if (targetRel === 'entity:unavailable') return true;
          throw new Error('policy offline');
        },
        fetch: async () => {
          throw new Error('projection offline');
        },
        enumerateEdges: () => [],
      },
    );

    expect(result).toEqual({ roots: [], nodes: [], edges: [], truncations: [] });
  });

  it('returns the same ordered graph for the same roots and adapter data', async () => {
    const entities = {
      'entity:root': {
        title: 'Root',
        edges: [
          { kind: 'relation' as const, relation: 'related', targetRel: 'entity:b' },
          { kind: 'relation' as const, relation: 'related', targetRel: 'entity:a' },
        ],
      },
      'entity:a': { title: 'A', edges: [] },
      'entity:b': { title: 'B', edges: [] },
    };
    const nextSituation = situation({ kind: 'graph', relations: ['related'] });

    const first = await resolveAuthorizedContractGraph(nextSituation, dependencies(entities));
    const second = await resolveAuthorizedContractGraph(nextSituation, dependencies(entities));

    expect(second).toEqual(first);
    expect(first.nodes.map(({ rel }) => rel)).toEqual(['entity:root', 'entity:b', 'entity:a']);
  });

  it('has zero direct/member/relation/nested unauthorized leakage under fuzzed graphs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 12 }),
        async (suffixes) => {
          const secretRels = suffixes.map((suffix) => `entity:SECRET_${suffix}`);
          const entities: Record<string, TestEntity> = {
            'entity:root': {
              title: 'Public root',
              edges: [
                ...secretRels.map((targetRel): ContractGraphEdgeReference => ({
                  kind: 'member',
                  targetRel,
                })),
                ...secretRels.map((targetRel): ContractGraphEdgeReference => ({
                  kind: 'relation',
                  relation: 'related',
                  targetRel,
                })),
                {
                  kind: 'relation',
                  relation: 'related',
                  targetRel: 'entity:public-child',
                },
              ],
            },
            'entity:public-child': {
              title: 'Public child',
              edges: secretRels.map((targetRel): ContractGraphEdgeReference => ({
                kind: 'relation',
                relation: 'related',
                targetRel,
              })),
            },
          };
          for (const [index, rel] of secretRels.entries()) {
            entities[rel] = {
              title: `SECRET_TITLE_${suffixes[index]}`,
              count: `SECRET_COUNT_${index}`,
              edges: [],
            };
          }
          const isAuthorized = (rel: string) => !rel.includes('SECRET_');
          const scenarios = [
            situation({ kind: 'selection' }, ['entity:root', secretRels[0]]),
            situation({ kind: 'members' }),
            situation({ kind: 'relations', relations: ['related'] }),
            situation({ kind: 'graph', relations: ['related'] }),
          ];

          for (const nextSituation of scenarios) {
            const result = await resolveAuthorizedContractGraph(
              nextSituation,
              dependencies(entities, isAuthorized),
            );
            const serialized = JSON.stringify(result);
            for (const rel of secretRels) expect(serialized).not.toContain(rel);
            expect(serialized).not.toMatch(/SECRET_TITLE|SECRET_COUNT/);
            expect(serialized).not.toMatch(/unauthorized|denied|hidden|placeholder/i);
            expect(result.nodes.length).toBeLessThanOrEqual(nextSituation.budget.maxNodes);
            expect(result.nodes.every(({ depth }) => depth <= nextSituation.budget.maxDepth)).toBe(
              true,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
