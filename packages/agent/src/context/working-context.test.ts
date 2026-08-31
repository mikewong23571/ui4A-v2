import type { SirenEntity } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { createContractClient } from '../contract/http';
import { loadWorkingContext } from './working-context';

function entity(rel: string, identity = rel): SirenEntity {
  return {
    class: ['resource'],
    properties: { rel, identity },
    actions: [],
    links: [],
  };
}

function thread(refs: string[]): SirenEntity {
  return {
    ...entity('thread:release', '发布公告'),
    class: ['work-thread', 'open'],
    properties: {
      rel: 'thread:release',
      identity: '发布公告',
      goal: { text: '发布公告', source: 'message:1' },
      status: 'open',
    },
    links: refs.map((rel, index) => ({
      rel: [['context', 'active', 'approval'][index % 3]!],
      href: `/api/entity?rel=${encodeURIComponent(rel)}`,
    })),
  };
}

describe('fresh authorized work context', () => {
  it('reads only explicit category references, deduplicates and never recurses', async () => {
    const root = thread(['editorial:one', 'publishing:one', 'editorial:one']);
    root.links.push({ rel: ['event'], href: '/api/events?afterSeq=2' });
    root.links.push({ rel: ['related'], href: '/api/entity?rel=thread%3Aunrelated' });
    const child = entity('editorial:one');
    child.links.push({ rel: ['context'], href: '/api/entity?rel=unattached' });
    const calls: string[] = [];
    const client = createContractClient('https://ui4a.test', async (url) => {
      const rel = new URL(url).searchParams.get('rel')!;
      calls.push(rel);
      return Response.json(rel === 'thread:release' ? root : child);
    });

    const context = await loadWorkingContext(client, 'thread:release');

    expect(calls).toEqual(['thread:release', 'editorial:one', 'publishing:one']);
    expect(context?.references).toEqual([
      { rel: 'editorial:one', categories: ['context', 'approval'] },
      { rel: 'publishing:one', categories: ['active'] },
    ]);
    expect(context?.observations.map(({ rel }) => rel)).toEqual([
      'editorial:one',
      'publishing:one',
    ]);
    expect(context).toMatchObject({ unavailable: false, truncated: 0 });
  });

  it('loads at most four related entities and reports undisclosed references', async () => {
    const root = thread(Array.from({ length: 20 }, (_, index) => `item:${index}`));
    const reads: string[] = [];
    const context = await loadWorkingContext(
      {
        async getEntity(rel) {
          reads.push(rel);
          return { status: 200, entity: rel === 'thread:release' ? root : entity(rel) };
        },
      },
      'thread:release',
    );
    expect(reads).toHaveLength(5);
    expect(context?.references).toHaveLength(4);
    expect(context?.truncated).toBe(16);
  });

  it('re-reads changed membership and facts each decision, excluding revoked data', async () => {
    let revision = 1;
    const client = {
      async getEntity(rel: string) {
        if (rel === 'thread:release') {
          return {
            status: 200,
            entity: thread(revision === 1 ? ['item:a', 'item:b'] : ['item:b']),
          };
        }
        return { status: 200, entity: entity(rel, `revision-${revision}`) };
      },
    };
    const first = await loadWorkingContext(client, 'thread:release');
    revision = 2;
    const second = await loadWorkingContext(client, 'thread:release');
    expect(first?.observations[0]?.entity.properties.identity).toBe('revision-1');
    expect(second?.observations).toHaveLength(1);
    expect(second?.observations[0]?.entity.properties.identity).toBe('revision-2');
    expect(JSON.stringify(second)).not.toContain('item:a');
  });

  it('denied root has no stale metadata, and a denied child has no error-body leakage', async () => {
    const denied = await loadWorkingContext(
      { getEntity: async () => ({ status: 403, error: 'secret-root-name' }) },
      'thread:release',
    );
    expect(denied).toEqual({
      rel: 'thread:release',
      observations: [],
      references: [],
      unavailable: true,
      truncated: 0,
    });
    const partial = await loadWorkingContext(
      {
        getEntity: async (rel) =>
          rel === 'thread:release'
            ? { status: 200, entity: thread(['known:ref']) }
            : { status: 403, error: 'secret-child-title' },
      },
      'thread:release',
    );
    expect(partial?.references).toEqual([{ rel: 'known:ref', categories: ['context'] }]);
    expect(partial?.observations).toEqual([]);
    expect(JSON.stringify({ denied, partial })).not.toContain('secret-');
  });

  it('uses the just-read current thread once, and rejects non-thread roots', async () => {
    let calls = 0;
    const client = {
      getEntity: async () => {
        calls += 1;
        return { status: 200, entity: entity('other') };
      },
    };
    expect(await loadWorkingContext(client, undefined)).toBeUndefined();
    expect(await loadWorkingContext(client, 'thread:release', thread([]))).toMatchObject({
      unavailable: false,
    });
    expect(calls).toBe(0);
    expect(await loadWorkingContext(client, 'not-thread')).toMatchObject({ unavailable: true });
  });
});
