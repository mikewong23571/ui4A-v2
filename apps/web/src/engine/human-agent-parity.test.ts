/**
 * T15 Phase G U18/U19 mechanical parity.
 *
 * These tests deliberately avoid judging natural-language behavior. They prove that the
 * renderer and Assistant protocol consume the same authorized Siren projection and submit
 * effects through the same HTTP action contract. Actor-specific confirmation remains an
 * explicit engine policy difference, while guards cannot be bypassed by changing actor.
 */
import { runAgent, type AgentDriver, type DriverContext, type FetchLike } from '@ui4a/agent';
import type { SirenEntity } from '@ui4a/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as execRoute } from '../app/api/exec/route';
import { GET as entityRoute } from '../app/api/entity/route';
import { execAction, fetchEntity, HUMAN_CHANNEL } from '../components/exec-client';
import { ensureEventsTable } from '../db/events';
import { getPool } from '../db/pool';
import { resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL!);
const ORIGIN = 'http://localhost:3100';

type ContractCall = { path: string; body?: Record<string, unknown> };

function contractFetch(calls: ContractCall[]): FetchLike {
  return async (input, init) => {
    const url = new URL(input, ORIGIN);
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({ path: `${url.pathname}${url.search}`, ...(body ? { body } : {}) });

    if (url.pathname === '/.well-known/ui4a.json') {
      return Response.json({ version: 'parity-test', surfaces: [], applications: [] });
    }
    if (url.pathname === '/api/entity') {
      return entityRoute(new Request(url));
    }
    if (url.pathname === '/api/exec') {
      return execRoute(
        new Request(url, {
          method: init?.method ?? 'POST',
          headers: init?.headers,
          body: init?.body,
        }),
      );
    }
    return Response.json({ error: `unexpected contract path ${url.pathname}` }, { status: 404 });
  };
}

async function resetDatabase(): Promise<void> {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
}

beforeEach(resetDatabase);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T15 U18 — renderer and Assistant authorized fact parity', () => {
  it('both entry paths receive the exact same title/category/body Siren contract', async () => {
    const calls: ContractCall[] = [];
    const fetchImpl = contractFetch(calls);
    vi.stubGlobal('fetch', fetchImpl);

    const rendererEntity = await fetchEntity('post:first-post');
    expect(rendererEntity).not.toBeNull();

    const contexts: DriverContext[] = [];
    const observingDriver: AgentDriver = {
      decide(context) {
        contexts.push(context);
        return Promise.resolve({
          kind: 'answer',
          content: '已读取授权文章字段。',
          sources: [{ rel: 'post:first-post', pointer: '/properties/fields/body' }],
        });
      },
    };
    const result = await runAgent(
      observingDriver,
      { verb: '阅读第一篇文章' },
      {
        baseUrl: ORIGIN,
        fetchImpl,
        startRel: 'post:first-post',
        actor: 'agent',
        principal: HUMAN_CHANNEL.principal,
        channel: 'chat',
      },
    );

    expect(result.outcome).toBe('answered');
    const assistantEntity = contexts[0]?.entity;
    expect(assistantEntity).toEqual(rendererEntity);
    expect((assistantEntity?.properties.fields as Record<string, unknown>) ?? {}).toEqual({
      title: '第一篇',
      category: 'essay',
      body: '这是第一篇完整文章，用来验证具体查看、正文阅读和跨刷新恢复链路。',
    });
    expect(contexts[0]?.observations).toEqual([
      { rel: 'post:first-post', entity: rendererEntity as SirenEntity },
    ]);
    expect(
      calls.filter((call) => call.path.includes('/api/entity?rel=post%3Afirst-post')),
    ).toHaveLength(2);
  });
});

describe('T15 U19 — renderer and Assistant action-contract parity', () => {
  it('same-principal unpublish submits the same rel/action/params and records the same effect', async () => {
    const humanCalls: ContractCall[] = [];
    vi.stubGlobal('fetch', contractFetch(humanCalls));
    const humanResult = await execAction({ rel: 'post:first-post', action: 'unpublish' });
    expect(humanResult.ok).toBe(true);
    if (!humanResult.ok) return;
    expect(humanResult.entity.properties.node).toBe('offline');
    const humanEvent = await pool.query(
      `SELECT rel, action, principal
       FROM events WHERE kind = 'action-executed' ORDER BY seq DESC LIMIT 1`,
    );

    await resetDatabase();
    const agentCalls: ContractCall[] = [];
    const fetchImpl = contractFetch(agentCalls);
    const effectDriver: AgentDriver = {
      decide(context) {
        if (context.successes.length === 0) {
          return Promise.resolve({
            kind: 'exec',
            action: 'unpublish',
            params: {},
            authorization: { sourceMessageId: 'u19-user', quote: '下线第一篇文章' },
          });
        }
        return Promise.resolve({ kind: 'done', summary: '第一篇文章已下线。' });
      },
    };
    const agentResult = await runAgent(
      effectDriver,
      { verb: '下线第一篇文章' },
      {
        baseUrl: ORIGIN,
        fetchImpl,
        startRel: 'post:first-post',
        actor: 'agent',
        principal: HUMAN_CHANNEL.principal,
        channel: 'chat',
        conversationMessages: [{ messageId: 'u19-user', role: 'user', content: '下线第一篇文章' }],
        requireEffectAuthorization: true,
      },
    );
    expect(agentResult.outcome).toBe('done');
    expect(agentResult.successes).toEqual([
      { rel: 'post:first-post', action: 'unpublish', params: {} },
    ]);
    const agentEvent = await pool.query(
      `SELECT rel, action, principal
       FROM events WHERE kind = 'action-executed' ORDER BY seq DESC LIMIT 1`,
    );

    const humanExec = humanCalls.find((call) => call.path === '/api/exec')?.body;
    const agentExec = agentCalls.find((call) => call.path === '/api/exec')?.body;
    expect({ rel: agentExec?.rel, action: agentExec?.action, params: agentExec?.params }).toEqual({
      rel: humanExec?.rel,
      action: humanExec?.action,
      params: humanExec?.params ?? {},
    });
    expect(agentExec?.principal).toBe(humanExec?.principal);
    expect(agentEvent.rows[0]).toEqual(humanEvent.rows[0]);
  });

  it('Assistant archive cannot bypass the declared high-risk confirmation', async () => {
    const calls: ContractCall[] = [];
    const fetchImpl = contractFetch(calls);
    const contexts: DriverContext[] = [];
    const archiveDriver: AgentDriver = {
      decide(context) {
        contexts.push(context);
        return Promise.resolve({
          kind: 'exec',
          action: 'archive',
          params: {},
          authorization: { sourceMessageId: 'u19-archive', quote: '归档第一篇文章' },
        });
      },
    };
    const result = await runAgent(
      archiveDriver,
      { verb: '归档第一篇文章' },
      {
        baseUrl: ORIGIN,
        fetchImpl,
        startRel: 'post:first-post',
        actor: 'agent',
        principal: HUMAN_CHANNEL.principal,
        channel: 'chat',
        conversationMessages: [
          { messageId: 'u19-archive', role: 'user', content: '归档第一篇文章' },
        ],
        requireEffectAuthorization: true,
      },
    );

    expect(result.outcome).toBe('suspended');
    expect(contexts[0]?.entity.actions.find((action) => action.name === 'archive')).toMatchObject({
      name: 'archive',
      'requires-confirmation': 'high',
    });
    const eventCounts = await pool.query(
      `SELECT kind, COUNT(*)::int AS count,
              MIN(detail->>'policy') AS policy
       FROM events
       WHERE rel IN ('post:first-post', 'confirmation:c1')
         AND kind IN ('confirmation-requested', 'action-executed')
       GROUP BY kind`,
    );
    expect(Object.fromEntries(eventCounts.rows.map((row) => [row.kind, row.count]))).toEqual({
      'confirmation-requested': 1,
    });
    expect(eventCounts.rows[0]?.policy).toMatch(/^cedar:/);
  });

  it('changing actor cannot bypass a failed action guard', async () => {
    async function guardFailure(actor: 'human' | 'agent') {
      await resetDatabase();
      for (const params of [
        { title: '重复标题' },
        { category: 'tech', tags: 'parity' },
        { body: '正文' },
      ]) {
        const response = await execRoute(
          new Request(`${ORIGIN}/api/exec`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              rel: 'article-drafting:main',
              action: 'next',
              params,
              actor,
              principal: HUMAN_CHANNEL.principal,
              channel: actor === 'human' ? 'renderer' : 'chat',
            }),
          }),
        );
        expect(response.status).toBe(200);
      }
      const response = await execRoute(
        new Request(`${ORIGIN}/api/exec`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            rel: 'article-drafting:main',
            action: 'publish',
            params: { title: '第一篇' },
            actor,
            principal: HUMAN_CHANNEL.principal,
            channel: actor === 'human' ? 'renderer' : 'chat',
          }),
        }),
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }

    const human = await guardFailure('human');
    const agent = await guardFailure('agent');
    expect(agent).toEqual(human);
    expect(agent).toMatchObject({
      status: 422,
      body: { layer: 'guard-failed', reason: expect.stringContaining('title-not-taken') },
    });
  });
});
