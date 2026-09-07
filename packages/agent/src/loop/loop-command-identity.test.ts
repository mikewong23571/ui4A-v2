import { describe, expect, it } from 'vitest';
import {
  executeThreadCommand,
  projectWorkThread,
  projectWorkThreads,
  type ExecRequest,
} from '@ui4a/engine';

import { runAgent } from './loop';
import { ScriptedDriver } from './loop-test-fixtures';
import { buildUserPrompt } from '../llm/prompts';
import type { AgentOperation, FetchLike } from '../types';

const authorization = { sourceMessageId: 'm1', quote: '创建工作线' };
const create = (params = { goal: 'ui4a 界面优化' }): Extract<AgentOperation, { kind: 'exec' }> => ({
  kind: 'exec',
  action: 'create',
  params,
  authorization,
});

function fixture() {
  let snapshot: Parameters<typeof executeThreadCommand>[1] = {
    instances: {},
    collections: {},
    threads: {},
  };
  const posts: ExecRequest[] = [];
  let births = 0;
  const deps = { flows: {}, guards: {}, principal: 'user:mike' };
  const fetchImpl: FetchLike = async (url, init) => {
    const target = new URL(url);
    if (target.pathname === '/.well-known/ui4a.json') {
      return Response.json({ version: 'v1', surfaces: [], applications: [] });
    }
    if (target.pathname === '/api/entity') return Response.json(projectWorkThreads(snapshot, deps));
    const request = JSON.parse(String(init?.body)) as ExecRequest;
    posts.push(request);
    const outcome = executeThreadCommand(request, snapshot);
    if (outcome.kind !== 'accepted' && outcome.kind !== 'replayed') {
      throw new Error(JSON.stringify(outcome));
    }
    if (outcome.kind === 'accepted') births += 1;
    snapshot = outcome.snapshot;
    return Response.json({
      entity: projectWorkThread(snapshot.threads![outcome.entityRel.slice(7)]!, snapshot, deps),
    });
  };
  return {
    posts,
    births: () => births,
    async run(ops: AgentOperation[]) {
      const driver = new ScriptedDriver([...ops, { kind: 'done', summary: '已创建' }]);
      const result = await runAgent(
        driver,
        { verb: '创建工作线' },
        {
          baseUrl: 'http://fixture',
          fetchImpl,
          startRel: 'threads',
          principal: 'user:mike',
          requireEffectAuthorization: true,
          conversationMessages: [
            { messageId: 'm1', role: 'user', content: '创建工作线' },
            { messageId: 'm2', role: 'user', content: '再创建工作线' },
          ],
        },
      );
      return { result, driver };
    },
  };
}

describe('client command identity across model decisions', () => {
  it('replays the incident three-create sequence through the real thread kernel with one birth', async () => {
    const app = fixture();
    const { result, driver } = await app.run([
      create(),
      create(),
      { ...create(), params: { commandId: 'model-invented', goal: 'ui4a 界面优化' } },
    ]);
    expect(result.outcome).toBe('done');
    expect(app.posts).toHaveLength(3);
    expect(app.births()).toBe(1);
    expect(new Set(app.posts.map((post) => post.params?.commandId)).size).toBe(1);
    const receiptRel = result.steps[0]?.entity?.rel;
    expect(receiptRel).toMatch(/^thread:/);
    expect(result.successes[0]).toMatchObject({ resultRel: receiptRel, sourceMessageId: 'm1' });
    const prompt = buildUserPrompt(driver.contexts[1]!);
    const successes = prompt.split('## 已成功的执行')[1]?.split('## 可引用')[0];
    expect(successes).toContain(receiptRel);
    expect(successes).toContain('m1');
  });

  it('keeps a different goal, a new authorization message, and a new run independent', async () => {
    const app = fixture();
    await app.run([
      create(),
      create({ goal: '另一个目标' }),
      { ...create(), authorization: { sourceMessageId: 'm2', quote: '再创建工作线' } },
    ]);
    await app.run([create()]);
    expect(app.births()).toBe(4);
  });
});
