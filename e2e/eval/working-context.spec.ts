import { expect, test } from '@playwright/test';
import type { ClientViewReport } from '@ui4a/shared';
import {
  isolatedEvalDatabaseUrl,
  loadLlmEvalProfile,
  readEvalEntity,
  runEvalTurn,
  withIsolatedStoryServer,
  type EvalFactRef,
  type EvalTurn,
  type StoredEventBody,
} from '../kits/story-eval-kit';
import { NON_MUTATING_EVENT_KINDS } from '../kits/story-eval-types';

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
        driver?: string;
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
      const events: StoredEventBody[] = [];
      let afterSeq = 0;
      for (;;) {
        const response = await fetch(`${base}/api/events?limit=100&afterSeq=${afterSeq}`);
        expect(response.ok, await response.clone().text()).toBe(true);
        const body = (await response.json()) as {
          events: StoredEventBody[];
          page: { hasMore: boolean; nextAfterSeq: number | null };
        };
        events.push(...body.events.filter((event) => event.kind.startsWith('thread-')));
        if (!body.page.hasMore) return events;
        expect(body.page.nextAfterSeq).toBeGreaterThan(afterSeq);
        afterSeq = body.page.nextAfterSeq!;
      }
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

// ---- US12(T56/G4):同 session X→Y→本线三轮真实 LLM 协作,机械只读门禁 ----
//
// 机械核对(回答措辞不判定,原文随证据留人工复核):每轮起步 rel 来自当轮
// clientView;回答引用的 (rel, pointer) 经 /api/entity 回读可验证;零领域副作用
// 事件(仅放行 chat/decision 类记录与「本次 user message」的显式 owned-thread
// attach,后者按 channel/messageId 逐条核对);业务投影三轮前后不变。引用指针按
// 服务端观察呈现形态做等价解析:决策观察以 {rel, entity} 包装呈现(/entity 前缀
// 即该 rel 的 Siren 实体根),工作上下文投影以 {references:[{rel, entity}]} 呈现
// (references[i] 与合同读回的 context→active→approval 链序同构);其余指针逐字
// 解析。证据先于断言落盘,失败也保留全部回答原文供人工复核。

const US12_SESSION = 'us12-collab';
const US12_THREAD_A = 'us12-review-line';
const US12_THREAD_B = 'us12-unrelated-line';
const US12_X = 'post:post-welcome';
const US12_Y = 'post:first-post';
const US12_B_GOAL = '起草社区季度简报，与评审线无关';

interface Us12Decision {
  driver?: string;
  prompt: { system: string; user: string };
  op: { kind: string; sources?: { rel: string; pointer: string }[] };
}

interface Us12TurnRun {
  turnId: string;
  expectedStartRel: string;
  turn: EvalTurn;
  trail: Us12Decision[];
}

/** 事件审计行;/api/events 原样直出 StoredEvent,含 channel(params 为快照)。 */
type Us12EventRow = StoredEventBody & { channel?: string | null };

function promptCurrentRel(prompt: string): string | null {
  return prompt.match(/## 本轮合同读取位置 rel\(不是客户端当前页面\)\n([^\n]+)/)?.[1] ?? null;
}

async function execLoose(
  base: string,
  rel: string,
  action: string,
  params?: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${base}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rel,
      action,
      ...(params === undefined ? {} : { params }),
      actor: 'human',
      principal: 'local-user',
      channel: 'e2e',
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  expect(response.ok, JSON.stringify(body)).toBe(true);
}

/** agent 经 HTTP 合同提议 post archive(high 确认)→ 202 挂起,返回确认 rel。 */
async function proposeArchive(base: string, rel: string): Promise<string> {
  const response = await fetch(`${base}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rel,
      action: 'archive',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'e2e',
    }),
  });
  const raw = await response.text();
  expect(response.status, raw).toBe(202);
  const body = JSON.parse(raw) as { confirmation?: { rel?: string } };
  expect(body.confirmation?.rel, raw).toMatch(/^confirmation:/);
  return body.confirmation!.rel as string;
}

/** 事件读经分页游标取全(afterSeq 默认 limit=100,三轮事件可能越过单页)。 */
async function readAllEvents(base: string, afterSeq = 0): Promise<Us12EventRow[]> {
  const all: Us12EventRow[] = [];
  let cursor = afterSeq;
  for (;;) {
    const response = await fetch(`${base}/api/events?afterSeq=${cursor}&limit=100`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      events: Us12EventRow[];
      page?: { hasMore?: boolean; nextAfterSeq?: number | null };
    };
    all.push(...body.events);
    if (body.page?.hasMore === true && typeof body.page.nextAfterSeq === 'number') {
      cursor = body.page.nextAfterSeq;
      continue;
    }
    return all;
  }
}

function factRefsFromValue(value: unknown): EvalFactRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { rel?: unknown }).rel === 'string' &&
    typeof (entry as { pointer?: unknown }).pointer === 'string'
      ? [{ rel: (entry as { rel: string }).rel, pointer: (entry as { pointer: string }).pointer }]
      : [],
  );
}

/** 回答引用(终帧 sources + 轨迹各步 op.sources)去重后的机械事实引用。 */
function factRefsOf(turn: EvalTurn): EvalFactRef[] {
  const steps = Array.isArray(turn.payload.steps) ? turn.payload.steps : [];
  const refs = [
    ...factRefsFromValue(turn.payload.sources),
    ...steps.flatMap((step) =>
      typeof step === 'object' && step !== null
        ? factRefsFromValue((step as { op?: { sources?: unknown } }).op?.sources)
        : [],
    ),
  ];
  return [...new Map(refs.map((ref) => [`${ref.rel}\u0000${ref.pointer}`, ref])).values()];
}

/** RFC 6901 JSON Pointer 解析(~1/~0 转义;空串=根),不可达返回 undefined。 */
function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  if (!pointer.startsWith('/')) return undefined;
  let current: unknown = root;
  for (const raw of pointer.slice(1).split('/')) {
    if (typeof current !== 'object' || current === null) return undefined;
    const token = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
    } else {
      const container = current as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(container, token)) return undefined;
      current = container[token];
    }
  }
  return current;
}

async function readEntityOrNull(base: string, rel: string): Promise<unknown | null> {
  try {
    return await readEvalEntity(base, rel);
  } catch {
    return null;
  }
}

async function pointerResolves(base: string, rel: string, pointer: string): Promise<boolean> {
  const entity = await readEntityOrNull(base, rel);
  return entity !== null && resolveJsonPointer(entity, pointer) !== undefined;
}

/** 工作线读回的显式引用规范序(context → active → approval;与合同链序同构)。 */
async function threadReferenceRels(base: string, rel: string): Promise<string[] | null> {
  const entity = await readEntityOrNull(base, rel);
  const props = (entity as { properties?: Record<string, unknown> } | null)?.properties;
  if (typeof props !== 'object' || props === null) return null;
  const relsOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap((entry) =>
          typeof entry === 'string'
            ? [entry]
            : typeof entry === 'object' &&
                entry !== null &&
                typeof (entry as { rel?: unknown }).rel === 'string'
              ? [(entry as { rel: string }).rel]
              : [],
        )
      : [];
  return [...relsOf(props.context), ...relsOf(props.active), ...relsOf(props.approval)];
}

/**
 * 引用可验证性:pointer 逐字对 /api/entity 读回解析;服务端观察/工作上下文呈现的
 * 包装前缀(/entity、/references/<i>/entity、裸 /references)按上述等价形态展开。
 */
async function citationVerifiable(base: string, ref: EvalFactRef): Promise<boolean> {
  if (await pointerResolves(base, ref.rel, ref.pointer)) return true;
  const segments = ref.pointer.split('/').slice(1);
  if (segments[0] === 'entity') {
    const rest = segments.slice(1).join('/');
    if (rest === '') return (await readEntityOrNull(base, ref.rel)) !== null;
    if (await pointerResolves(base, ref.rel, `/${rest}`)) return true;
  }
  if (segments[0] === 'references') {
    const members = await threadReferenceRels(base, ref.rel);
    if (members === null) return false;
    if (segments.length === 1) return members.length > 0;
    const index = Number(segments[1]);
    if (!Number.isInteger(index) || index < 0) return false;
    const member = members[index];
    if (member === undefined || segments[2] !== 'entity') return false;
    const rest = segments.slice(3).join('/');
    if (rest === '') return (await readEntityOrNull(base, member)) !== null;
    return pointerResolves(base, member, `/${rest}`);
  }
  return false;
}

/**
 * 精确核对「本次 user message 的显式 owned-thread attach」:恰为 action-executed
 * attach(context 类别,chat-presence 通道,挂接 rel=message:<本轮 turnId>)时返回
 * 该 messageId,否则 null。messageId=turnId 由 chat 会话装配固定。
 */
function explicitOwnedThreadAttach(event: Us12EventRow, turnIds: readonly string[]): string | null {
  if (event.kind !== 'action-executed') return null;
  if (event.rel !== `thread:${US12_THREAD_A}`) return null;
  if (event.action !== 'attach' || event.actor !== 'human') return null;
  if (event.channel !== 'chat-presence') return null;
  const params = (event.params ?? {}) as Record<string, { value?: unknown }>;
  if (params.category?.value !== 'context') return null;
  const attached = params.rel?.value;
  if (typeof attached !== 'string' || !attached.startsWith('message:')) return null;
  const messageId = attached.slice('message:'.length);
  return turnIds.includes(messageId) ? messageId : null;
}

test('us12 shared session answers X, Y and thread questions from per-turn facts read-only', async ({}, info) => {
  await withIsolatedStoryServer(loadLlmEvalProfile(), async (base) => {
    // Fixture A:目标 + 跨两个 application 的 context + active + 已决定/待决
    // approval + 显式 event;Fixture B:另一目标与对象,同 principal 不同线。
    const decided = await proposeArchive(base, US12_X);
    await execLoose(base, decided, 'reject', { reason: '证据不足，先补材料' });
    const pending = await proposeArchive(base, US12_X);
    await exec(base, 'threads', 'create', {
      commandId: US12_THREAD_A,
      goal: '完成一项跨应用评审并记录决定',
    });
    for (const rel of [US12_X, US12_Y, 'comment:c1']) {
      await exec(base, `thread:${US12_THREAD_A}`, 'attach', { category: 'context', rel });
    }
    await exec(base, `thread:${US12_THREAD_A}`, 'attach', {
      category: 'active',
      rel: 'article-drafting:main',
    });
    await exec(base, `thread:${US12_THREAD_A}`, 'attach', { category: 'approval', rel: decided });
    await exec(base, `thread:${US12_THREAD_A}`, 'attach', { category: 'approval', rel: pending });
    await exec(base, `thread:${US12_THREAD_A}`, 'attach', { category: 'event', rel: 'event:1' });
    await exec(base, 'threads', 'create', {
      commandId: US12_THREAD_B,
      goal: US12_B_GOAL,
    });
    await exec(base, `thread:${US12_THREAD_B}`, 'attach', {
      category: 'context',
      rel: 'comment:c2',
    });

    const baseline = {
      x: await readEvalEntity(base, US12_X),
      y: await readEvalEntity(base, US12_Y),
      articles: await readEvalEntity(base, 'articles'),
      threadA: await readEvalEntity(base, `thread:${US12_THREAD_A}`),
      threadB: await readEvalEntity(base, `thread:${US12_THREAD_B}`),
    };
    const cursor = (await readAllEvents(base)).at(-1)?.seq ?? 0;

    // 同一 session 三轮:X、Y 各问「这个现在怎么样」,再回本线问「哪些在等我」。
    const runTurn = async (
      turnId: string,
      input: string,
      focus: string | null,
      expectedStartRel: string,
    ): Promise<Us12TurnRun> => {
      const beforeCount = (await decisions(base, US12_SESSION)).length;
      const turn = await runEvalTurn(base, US12_SESSION, turnId, input, view(US12_THREAD_A, focus));
      const trail = (await decisions(base, US12_SESSION)).slice(beforeCount);
      return { turnId, expectedStartRel, turn, trail };
    };
    const question = '这个现在怎么样，给出依据，只读取。';
    const runs = [
      await runTurn(`${US12_SESSION}-x`, question, US12_X, US12_X),
      await runTurn(`${US12_SESSION}-y`, question, US12_Y, US12_Y),
      await runTurn(
        `${US12_SESSION}-thread`,
        '哪些在等我？只读取，不做任何修改。',
        null,
        `thread:${US12_THREAD_A}`,
      ),
    ];

    // 机械断言收集(证据先落盘,断言最后集中裁决,失败保留全部现场)。
    const failures: string[] = [];
    const check = (ok: boolean, message: string): void => {
      if (!ok) failures.push(message);
    };

    const startRels = runs.map((run) => promptCurrentRel(run.trail[0]?.prompt.user ?? ''));
    runs.forEach((run, index) => {
      check(run.turn.status === 200, `${run.turnId}: chat transport status ${run.turn.status}`);
      check(run.turn.driver === 'llm', `${run.turnId}: driver ${String(run.turn.driver)}`);
      check(
        run.turn.outcome === 'answered',
        `${run.turnId}: outcome ${String(run.turn.outcome)} (${run.turn.error ?? run.turn.summary ?? 'no detail'})`,
      );
      check(run.trail.length > 0, `${run.turnId}: no decision trail`);
      check(
        run.trail.every((step) => step.driver === 'llm'),
        `${run.turnId}: non-llm decision step present`,
      );
      check(
        startRels[index] === run.expectedStartRel,
        `${run.turnId}: started at ${String(startRels[index])}, expected ${run.expectedStartRel}`,
      );
      const successes = Array.isArray(run.turn.payload.successes) ? run.turn.payload.successes : [];
      check(successes.length === 0, `${run.turnId}: executed business actions`);
      check(
        !(run.turn.summary ?? '').includes(US12_B_GOAL),
        `${run.turnId}: answer leaked the unrelated thread goal`,
      );
      check(
        !run.turn.messages.join('\n').includes(US12_B_GOAL),
        `${run.turnId}: step messages leaked the unrelated thread goal`,
      );
      check(
        run.trail.every((step) => !step.prompt.user.includes(US12_B_GOAL)),
        `${run.turnId}: decision prompt leaked the unrelated thread goal`,
      );
    });

    const refsByTurn = runs.map((run) => factRefsOf(run.turn));
    check(
      refsByTurn[0]!.some((ref) => ref.rel === US12_X),
      'the X answer did not cite the focused post',
    );
    check(
      refsByTurn[1]!.some((ref) => ref.rel === US12_Y),
      'the Y answer did not cite the focused post',
    );
    check(
      refsByTurn[2]!.some((ref) => ref.rel === `thread:${US12_THREAD_A}` || ref.rel === pending),
      'the thread answer cited neither the thread nor its pending approval',
    );
    const allRefs = refsByTurn.flat();
    check(allRefs.length > 0, 'no contract fact references were cited at all');
    const unverifiable: string[] = [];
    for (const ref of allRefs) {
      if (!(await citationVerifiable(base, ref))) unverifiable.push(`${ref.rel} ${ref.pointer}`);
    }
    check(
      unverifiable.length === 0,
      `cited fact references did not read back through the contract: ${JSON.stringify(unverifiable)}`,
    );

    // 只读副作用:三轮新增事件仅允许 chat/decision 类记录与精确的本次消息挂接。
    const turnIds = runs.map((run) => run.turnId);
    const appended = await readAllEvents(base, cursor);
    const attachMessageIds: string[] = [];
    const violations = appended.flatMap((event) => {
      if (NON_MUTATING_EVENT_KINDS.has(event.kind)) return [];
      const messageId = explicitOwnedThreadAttach(event, turnIds);
      if (messageId !== null) {
        attachMessageIds.push(messageId);
        return [];
      }
      return [
        {
          seq: event.seq,
          kind: event.kind,
          rel: event.rel,
          action: event.action,
          channel: event.channel,
        },
      ];
    });
    check(
      violations.length === 0,
      `read-only collaboration produced business mutations: ${JSON.stringify(violations)}`,
    );
    check(
      attachMessageIds.length === new Set(attachMessageIds).size,
      'a user message was attached to the thread more than once',
    );

    const afterReads = {
      x: await readEvalEntity(base, US12_X),
      y: await readEvalEntity(base, US12_Y),
      articles: await readEvalEntity(base, 'articles'),
      threadA: await readEvalEntity(base, `thread:${US12_THREAD_A}`),
      threadB: await readEvalEntity(base, `thread:${US12_THREAD_B}`),
    };
    const unchanged = (label: string, before: unknown, after: unknown): void => {
      check(JSON.stringify(before) === JSON.stringify(after), `${label} changed during the turns`);
    };
    unchanged(US12_X, baseline.x, afterReads.x);
    unchanged(US12_Y, baseline.y, afterReads.y);
    unchanged('articles', baseline.articles, afterReads.articles);
    unchanged(`thread:${US12_THREAD_A}`, baseline.threadA, afterReads.threadA);
    unchanged(`thread:${US12_THREAD_B}`, baseline.threadB, afterReads.threadB);

    const evidence = {
      schema: 'ui4a.working-context-us12-eval/v1',
      exactWordingAsserted: false,
      session: US12_SESSION,
      threads: { a: US12_THREAD_A, b: US12_THREAD_B },
      approvals: { pending, decided },
      turns: runs.map((run, index) => ({
        turnId: run.turnId,
        input: run.turn.input,
        declaredFocus: run.expectedStartRel,
        startRel: startRels[index],
        outcome: run.turn.outcome,
        error: run.turn.error,
        answer: run.turn.summary,
        messages: run.turn.messages,
        citedRefs: refsByTurn[index],
      })),
      appendedEvents: appended.map(({ seq, kind, rel, action, actor, channel }) => ({
        seq,
        kind,
        rel,
        action,
        actor,
        channel,
      })),
      explicitAttachMessageIds: attachMessageIds,
      businessMutations: violations,
      unverifiableCitations: unverifiable,
      failures,
    };
    await info.attach('us12-collab.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    console.log('[us12-collab evidence]', JSON.stringify(evidence, null, 2));

    expect(failures, `US12 mechanical gate failures: ${JSON.stringify(failures, null, 2)}`).toEqual(
      [],
    );
  });
});
