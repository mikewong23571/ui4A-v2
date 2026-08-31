import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DriverContext, FetchLike } from '@ui4a/agent';
import type { DbExecutor } from '@ui4a/db/events';
import type { SirenEntity } from '@ui4a/engine';

import { runAgentStep, type AgentStepArgs } from '../delegation';

function entity(rel: string, properties: Record<string, unknown> = {}): SirenEntity {
  return {
    class: [rel.startsWith('thread:') ? 'work-thread' : 'resource'],
    properties: { rel, ...properties },
    actions: [],
    links: [
      { rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` },
      ...(['context', 'active', 'approval'] as const).flatMap((category) =>
        Array.isArray(properties[category])
          ? (properties[category] as string[]).map((reference) => ({
              rel: [category],
              href: `/api/entity?rel=${encodeURIComponent(reference)}`,
            }))
          : [],
      ),
    ],
    'guard-results': [],
  };
}

function step(stepNumber: number): AgentStepArgs {
  return {
    delegationId: 'pinned-workline',
    step: stepNumber,
    goal: { verb: '进展如何' },
    driverKind: 'llm',
    baseUrl: 'http://contract.test',
    contextRel: 'thread:release',
    currentRel: 'post:release',
    trail: [],
    successes: [],
  };
}

function database() {
  const records: unknown[] = [];
  const db: DbExecutor = {
    async query<R extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      if (sql.startsWith('SELECT detail FROM events')) {
        return {
          rows: records.map((detail) => ({ detail })),
          rowCount: records.length,
        } as unknown as QueryResult<R>;
      }
      if (sql.startsWith('INSERT INTO events')) {
        records.push(JSON.parse(String(values?.[8])));
        return {
          rows: [{ seq: String(records.length), ts: new Date('2026-09-01') }],
          rowCount: 1,
        } as unknown as QueryResult<R>;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult<R>;
    },
  };
  return { db, records };
}

function transport() {
  const entities: Record<string, SirenEntity> = {
    'thread:release': entity('thread:release', {
      goal: { text: '发布公告', source: 'message:release' },
      context: ['draft:copy'],
      active: ['post:release'],
      approval: [],
    }),
    'thread:other': entity('thread:other', { goal: { text: 'PRIVATE_OTHER_LINE' }, context: [] }),
    'draft:copy': entity('draft:copy', { identity: '公告草稿', status: 'draft' }),
    'post:release': entity('post:release', { identity: '公告', status: 'draft' }),
  };
  let version = '1';
  const denied = new Set<string>();
  const fetchImpl: FetchLike = vi.fn(async (url) => {
    const target = new URL(url);
    if (target.pathname === '/.well-known/ui4a.json') {
      return Response.json({ version, surfaces: [], applications: [] });
    }
    const rel = target.searchParams.get('rel') ?? '';
    if (denied.has(rel))
      return Response.json({ error: { code: 'scope_insufficient' } }, { status: 403 });
    const resource = entities[rel];
    return resource
      ? Response.json(resource)
      : Response.json({ error: 'not found' }, { status: 404 });
  });
  return {
    entities,
    denied,
    fetchImpl,
    setVersion: (value: string) => {
      version = value;
    },
  };
}

describe('delegated working context', () => {
  it('re-reads the pinned line and its current authorized references for every new step', async () => {
    const { db } = database();
    const contract = transport();
    const contexts: DriverContext[] = [];
    const driver = {
      decide: vi.fn((context: DriverContext) => {
        contexts.push(context);
        return { kind: 'answer' as const, content: '当前进度', sources: [] };
      }),
    };

    await runAgentStep({ db, fetchImpl: contract.fetchImpl, driver }, step(1));
    contract.entities['thread:release'] = entity('thread:release', {
      goal: { text: '发布公告', source: 'message:release' },
      context: ['draft:revised'],
      active: ['post:release'],
      approval: [],
    });
    contract.entities['draft:revised'] = entity('draft:revised', {
      identity: '修订稿',
      status: 'ready',
    });
    contract.entities['post:release']!.properties.status = 'published';
    contract.setVersion('2');
    await runAgentStep({ db, fetchImpl: contract.fetchImpl, driver }, step(2));

    expect(contexts[0]?.workingContext?.rel).toBe('thread:release');
    expect(JSON.stringify(contexts[0]?.workingContext)).toContain('draft:copy');
    expect(JSON.stringify(contexts[1]?.workingContext)).toContain('draft:revised');
    expect(JSON.stringify(contexts[1]?.workingContext)).not.toContain('draft:copy');
    expect(JSON.stringify(contexts[1]?.workingContext?.observations)).toContain('修订稿');
    expect(contexts[1]?.entity.properties.status).toBe('published');
    expect(contexts[1]?.sitemap?.version).toBe('2');
    expect(JSON.stringify(contexts)).not.toContain('PRIVATE_OTHER_LINE');
    expect(contexts[1]?.app).toBeUndefined();
  });

  it('replays a recorded step without HTTP or another model decision', async () => {
    const { db, records } = database();
    const contract = transport();
    const driver = {
      decide: vi.fn(() => ({ kind: 'answer' as const, content: '已回答', sources: [] })),
    };
    const original = await runAgentStep({ db, fetchImpl: contract.fetchImpl, driver }, step(1));
    vi.mocked(contract.fetchImpl).mockClear();
    driver.decide.mockClear();

    const recovered = await runAgentStep({ db, fetchImpl: contract.fetchImpl, driver }, step(1));

    expect(recovered).toMatchObject(original);
    expect(contract.fetchImpl).not.toHaveBeenCalled();
    expect(driver.decide).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('workingContext');
  });

  it('does not reuse workline facts after its authorized root becomes unavailable', async () => {
    const { db } = database();
    const contract = transport();
    const contexts: DriverContext[] = [];
    const driver = {
      decide: (context: DriverContext) => {
        contexts.push(context);
        return { kind: 'answer' as const, content: '当前可读范围', sources: [] };
      },
    };
    await runAgentStep({ db, fetchImpl: contract.fetchImpl, driver }, step(1));
    contract.denied.add('thread:release');
    await runAgentStep({ db, fetchImpl: contract.fetchImpl, driver }, step(2));

    expect(contexts[1]?.workingContext).toMatchObject({
      unavailable: true,
      observations: [],
      references: [],
    });
    expect(contexts[1]?.workingContext?.entity).toBeUndefined();
    expect(JSON.stringify(contexts[1]?.workingContext)).not.toContain('发布公告');
    expect(JSON.stringify(contexts[1]?.workingContext)).not.toContain('公告草稿');
  });
});
