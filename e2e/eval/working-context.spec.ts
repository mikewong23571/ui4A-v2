import { expect, test } from '@playwright/test';
import type { ClientViewReport } from '@ui4a/shared';
import {
  isolatedEvalDatabaseUrl,
  loadLlmEvalProfile,
  readEvalEntity,
  runEvalTurn,
  withIsolatedStoryServer,
  type StoredEventBody,
} from '../kits/story-eval-kit';

test.skip(process.env.RUN_LLM_EVAL !== '1', 'RUN_LLM_EVAL=1 requires the configured provider');
test.beforeEach(() => {
  test.setTimeout(420_000);
  expect(process.env.DATABASE_URL).toBe(isolatedEvalDatabaseUrl());
});

function view(thread: string | null = null, focus: string | null = null): ClientViewReport {
  return {
    schemaVersion: 2,
    presence: {
      clientInstanceId: 'working-context-eval',
      site: 'workstation',
      scope: null,
      thread,
      focus,
    },
  };
}

async function decisions(base: string, sessionId: string) {
  const response = await fetch(
    `${base}/api/events?kind=agent-decision&limit=100&rel=${encodeURIComponent(`chat:${sessionId}`)}`,
  );
  expect(response.ok).toBe(true);
  const body = (await response.json()) as { events: StoredEventBody[] };
  return body.events.map(
    (event) =>
      event.detail as {
        prompt: { system: string; user: string };
        op: { kind: string; sources?: { rel: string; pointer: string }[] };
      },
  );
}

async function exec(base: string, rel: string, action: string, params: Record<string, unknown>) {
  const response = await fetch(`${base}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rel,
      action,
      params,
      actor: 'human',
      principal: 'local-user',
      channel: 'e2e',
    }),
  });
  const body: unknown = await response.json();
  expect(response.ok, JSON.stringify(body)).toBe(true);
  expect(body).toHaveProperty('entity');
}

test('unlocated capability questions start at application discovery', async ({}, info) => {
  await withIsolatedStoryServer(loadLlmEvalProfile(), async (base) => {
    const before = await readEvalEntity(base, 'articles');
    const turn = await runEvalTurn(
      base,
      'global-capabilities',
      'global-capabilities-1',
      '有哪些可用应用？请简要列出名称和用途，不执行任何操作。',
      view(),
    );
    expect(turn.outcome, JSON.stringify(turn)).toBe('answered');
    expect(turn.driver).toBe('llm');
    expect(turn.summary).not.toContain('主应用');
    for (const title of ['内容发布', '社区互动', '编辑写作']) expect(turn.summary).toContain(title);
    const trail = await decisions(base, 'global-capabilities');
    expect(trail[0]?.prompt.user).toContain('rel(不是客户端当前页面)\napplications');
    expect(trail[0]?.prompt.system).not.toContain('应用: publishing');
    expect(trail.every((step) => ['answer', 'navigate', 'clarify'].includes(step.op.kind))).toBe(
      true,
    );
    expect(await readEvalEntity(base, 'articles')).toEqual(before);
    await info.attach('global-context.json', {
      body: JSON.stringify({ turn, trail }),
      contentType: 'application/json',
    });
  });
});

test('a workline answers about its explicit cross-application resources', async ({}, info) => {
  await withIsolatedStoryServer(loadLlmEvalProfile(), async (base) => {
    await exec(base, 'threads', 'create', {
      id: 'announcement-review',
      goal: '核对公告与评论',
      goalSource: 'message:announcement-review',
    });
    await exec(base, 'threads', 'create', {
      id: 'unrelated-work',
      goal: '不相关的另一件事',
      goalSource: 'message:unrelated-work',
    });
    for (const rel of ['post:post-welcome', 'comments']) {
      await exec(base, 'thread:announcement-review', 'attach', { category: 'context', rel });
    }
    await exec(base, 'thread:unrelated-work', 'attach', { category: 'context', rel: 'todos' });
    const before = await readEvalEntity(base, 'thread:announcement-review');
    const turn = await runEvalTurn(
      base,
      'workline-resources',
      'workline-resources-1',
      '这条工作线的目标是什么？关联了哪两个对象？请按名字列出，仅阅读，不做任何修改。',
      view('announcement-review'),
    );
    expect(turn.outcome, JSON.stringify(turn)).toBe('answered');
    expect(turn.summary).toContain('核对公告与评论');
    expect(turn.summary).toContain('欢迎来到 UI4A');
    expect(turn.summary).toContain('评论');
    const trail = await decisions(base, 'workline-resources');
    expect(trail[0]?.prompt.user).toContain('thread:announcement-review');
    expect(trail[0]?.prompt.user).toContain('post:post-welcome');
    expect(trail[0]?.prompt.user).not.toContain('不相关的另一件事');
    expect(trail.every((step) => ['answer', 'navigate', 'clarify'].includes(step.op.kind))).toBe(
      true,
    );
    expect(await readEvalEntity(base, 'thread:announcement-review')).toEqual(before);
    await info.attach('workline-context.json', {
      body: JSON.stringify({ turn, trail }),
      contentType: 'application/json',
    });
  });
});
