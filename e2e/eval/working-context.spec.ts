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

async function exec(
  base: string,
  rel: string,
  action: string,
  params: Record<string, unknown>,
  principal = 'local-user',
) {
  const response = await fetch(`${base}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rel,
      action,
      params,
      actor: 'human',
      principal,
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
      commandId: 'announcement-review',
      goal: '核对公告与评论',
    });
    await exec(base, 'threads', 'create', {
      commandId: 'unrelated-work',
      goal: '不相关的另一件事',
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

test('homepage question uses the visible authorized roots and current work without treating empty delegations as no work', async ({}, info) => {
  await withIsolatedStoryServer(loadLlmEvalProfile(), async (base) => {
    const sessionId = 'home-context';
    const principal = `user:${sessionId}`;
    await exec(
      base,
      'threads',
      'create',
      { commandId: 'home-current', goal: '核验本次发布的测试证据' },
      principal,
    );
    await exec(
      base,
      'threads',
      'create',
      { commandId: 'home-paused', goal: '等待补齐评审材料' },
      principal,
    );
    await exec(base, 'thread:home-paused', 'pause', {}, principal);
    await exec(
      base,
      'threads',
      'create',
      { commandId: 'home-history', goal: '已经归档的研究事项' },
      principal,
    );
    await exec(base, 'thread:home-history', 'archive', {}, principal);
    await exec(
      base,
      'threads',
      'create',
      { commandId: 'home-private', goal: '其他用户的保密目标' },
      'other-principal',
    );
    const roots = ['inbox', 'threads-current', 'delegations-current'];
    const readAsOwner = async (rel: string) => {
      const response = await fetch(`${base}/api/entity?rel=${encodeURIComponent(rel)}`, {
        headers: { 'x-ui4a-principal': principal },
      });
      expect(response.ok).toBe(true);
      return response.json() as Promise<{
        properties: Record<string, unknown>;
        entities?: Array<{ properties: Record<string, unknown> }>;
      }>;
    };
    const threadEvents = async () => {
      const response = await fetch(`${base}/api/events?limit=1000`);
      expect(response.ok).toBe(true);
      const body = (await response.json()) as { events: StoredEventBody[] };
      return body.events.filter((event) => event.kind.startsWith('thread-'));
    };
    const before = await Promise.all(roots.map(readAsOwner));
    const beforeEvents = await threadEvents();
    expect(before[1].entities?.map((entry) => entry.properties.rel)).toEqual(
      expect.arrayContaining(['thread:home-current', 'thread:home-paused']),
    );
    expect(before[2].entities ?? []).toHaveLength(0);
    const homeView: ClientViewReport = {
      ...view(),
      presence: { ...view().presence, focus: { selection: roots } },
    };
    const turn = await runEvalTurn(
      base,
      sessionId,
      'home-context-1',
      '我在首页。这里有什么需要我决定，还有哪些工作可以继续？请按当前可见事实说明，给出引用依据，只阅读，不执行修改。',
      homeView,
    );
    expect(turn.outcome, JSON.stringify(turn)).toBe('answered');
    expect(turn.driver).toBe('llm');
    const trail = await decisions(base, sessionId);
    expect(trail.length).toBeGreaterThan(0);
    for (const root of roots) expect(trail[0].prompt.user).toContain(root);
    const sources = trail.flatMap((step) => step.op.sources ?? []);
    expect(sources.some((source) => source.rel === 'inbox')).toBe(true);
    expect(
      sources.some((source) =>
        ['threads-current', 'thread:home-current', 'thread:home-paused'].includes(source.rel),
      ),
    ).toBe(true);
    expect(
      sources.every(
        (source) => source.rel !== 'thread:home-private' && source.rel !== 'thread:home-history',
      ),
    ).toBe(true);
    expect(trail.every((step) => ['answer', 'navigate', 'clarify'].includes(step.op.kind))).toBe(
      true,
    );
    expect(trail.every((step) => !step.prompt.user.includes('其他用户的保密目标'))).toBe(true);
    expect(await Promise.all(roots.map(readAsOwner))).toEqual(before);
    expect(await threadEvents()).toEqual(beforeEvents);
    await info.attach('home-context.json', {
      body: JSON.stringify({ before, homeView, turn, trail }),
      contentType: 'application/json',
    });
  });
});
