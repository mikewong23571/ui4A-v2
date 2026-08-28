import { beforeEach, describe, expect, it } from 'vitest';

import { applyEffects, contentVersion, fold, judge } from '@ui4a/engine';
import type { FlowDefinition } from '@ui4a/engine';
import type { EngineSnapshot, FieldValue, GuardRegistry } from '@ui4a/shared';

import { appendEvent, ensureEventsTable, listEvents, readLog, type DbExecutor } from './events';
import { getPool } from './pool';

// I5 重放一致性集成测试(GOAL I5:从空库重放事件日志,实体状态 hash 与重放前一致)。
//
// 证明「日志是完整输入」:
// - 在线路径 = judge(三层裁决)→ applyEffects(效果)→ appendEvent(落日志)→ 增量持有新快照;
// - 重放路径 = fold(从 PG 读出的全部日志)——注意 fold 的依赖里没有 guard 注册表,
//   结构上证明重放不重新裁决,只折叠日志;
// - 两条路径的快照经 canonical JSON + FNV-1a 内容 hash(engine 的 contentVersion,
//   勿重复造轮子)必须相等。快照不含时间戳类字段(createdAt 从未写入),
//   hash 稳定不依赖时钟。
//
// 前置:`docker compose up -d --wait`;beforeEach TRUNCATE 自清理,可重复跑。
const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const pool = getPool(CONNECTION_STRING);

// ----- 测试自造最小业务域(spec 非目标:Phase C 才落种子域)-----

const commentModeration: FlowDefinition = {
  name: 'comment-moderation',
  initial: 'pending',
  nodes: [
    {
      name: 'pending',
      actions: [
        { name: 'approve', title: '通过', to: 'approved', guards: ['is-pending'] },
        { name: 'hold', title: '挂起', to: 'pending', guards: ['never-true'] },
      ],
    },
    { name: 'approved', actions: [] },
  ],
};

const articleDrafting: FlowDefinition = {
  name: 'article-drafting',
  initial: 'basic-info',
  nodes: [
    {
      name: 'basic-info',
      fields: [{ name: 'title', type: 'text', required: true }],
      actions: [{ name: 'next', title: '下一步', to: 'classification' }],
    },
    {
      name: 'classification',
      fields: [
        { name: 'category', type: 'select', required: true, options: ['tech', 'essay'] },
        { name: 'tags', type: 'text' },
      ],
      actions: [{ name: 'next', title: '下一步', to: 'content' }],
    },
    {
      name: 'content',
      fields: [{ name: 'body', type: 'textarea', required: true }],
      actions: [{ name: 'next', title: '完成', to: 'ready' }],
    },
    {
      name: 'ready',
      actions: [
        {
          name: 'publish',
          title: '发布',
          to: 'done',
          fields: [{ name: 'title', type: 'text', required: true }],
          effect: [
            { type: 'transition' },
            {
              type: 'append',
              collection: 'articles',
              'resource-type': 'post',
              'name-from': 'title',
              node: 'published',
            },
          ],
        },
      ],
    },
    { name: 'done', actions: [] },
  ],
};

const flows: Record<string, FlowDefinition> = {
  'comment-moderation': commentModeration,
  'article-drafting': articleDrafting,
};

const guards: GuardRegistry = {
  'is-pending': (context) => context.instance.node === 'pending',
  'never-true': () => false,
};

const seedSnapshot: EngineSnapshot = {
  instances: {
    'comment:c1': {
      rel: 'comment:c1',
      flow: 'comment-moderation',
      node: 'pending',
      fields: { body: { value: '好文章', origin: 'intent' } },
    },
    'article-drafting:main': {
      rel: 'article-drafting:main',
      flow: 'article-drafting',
      node: 'basic-info',
      fields: {},
    },
  },
  collections: { comments: ['comment:c1'] },
};

// ----- 在线执行路径(Phase C 的 /api/exec 雏形:裁决 → 效果 → 落日志)-----

interface OnlineRequest {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
  paramOrigins?: Record<string, 'default' | 'intent' | 'proposal' | 'elicited' | 'effect'>;
  actor?: 'human' | 'agent';
  principal?: string;
}

function requestParams(request: OnlineRequest): Record<string, FieldValue> {
  return Object.fromEntries(
    Object.entries(request.params ?? {}).map(([name, value]) => [
      name,
      { value, origin: request.paramOrigins?.[name] ?? 'intent' },
    ]),
  );
}

async function execOnline(
  db: DbExecutor,
  request: OnlineRequest,
  snapshot: EngineSnapshot,
): Promise<EngineSnapshot> {
  const verdict = judge({ ...request, channel: 'http' }, snapshot, { flows, guards });

  if (verdict.kind === 'rejected') {
    // 拒绝即数据(I6):不改状态,带结构化原因入日志。
    await appendEvent(db, {
      kind: 'action-rejected',
      rel: request.rel,
      action: request.action,
      actor: request.actor ?? 'human',
      principal: request.principal,
      channel: 'http',
      params: requestParams(request),
      reason: verdict.reason,
      detail: verdict.detail,
    });
    return snapshot;
  }

  const outcome = applyEffects({ ...request, channel: 'http' }, verdict.effects, snapshot, {
    flows,
  });
  for (const event of outcome.events) {
    await appendEvent(db, {
      kind: event.kind,
      rel: event.rel,
      action: event.action,
      actor: event.actor,
      principal: event.principal,
      channel: event.channel,
      params: event.params,
    });
  }
  return outcome.snapshot;
}

/** 跑一遍混合操作序列(成功/三层各拒绝/append 效果),返回在线终态快照。 */
async function runScenario(db: DbExecutor): Promise<EngineSnapshot> {
  await appendEvent(db, {
    kind: 'seed',
    rel: 'seed:bootstrap',
    detail: {
      instances: seedSnapshot.instances,
      collections: seedSnapshot.collections,
    },
  });
  let snapshot = seedSnapshot;

  // 三层各一次拒绝(声明层 / guard 层 / schema 层)——全部留痕、不改状态。
  snapshot = await execOnline(
    db,
    { rel: 'comment:c1', action: 'explode', params: {}, actor: 'agent' },
    snapshot,
  );
  snapshot = await execOnline(
    db,
    { rel: 'comment:c1', action: 'hold', params: {}, actor: 'agent' },
    snapshot,
  );
  snapshot = await execOnline(
    db,
    { rel: 'article-drafting:main', action: 'next', params: {}, actor: 'agent' },
    snapshot,
  );

  // 成功序列:向导三步(其一带 proposal 出处)→ publish(append)→ 评论通过。
  snapshot = await execOnline(
    db,
    {
      rel: 'article-drafting:main',
      action: 'next',
      params: { title: 'Hello World' },
      actor: 'agent',
      principal: 'user:mike',
    },
    snapshot,
  );
  snapshot = await execOnline(
    db,
    {
      rel: 'article-drafting:main',
      action: 'next',
      params: { category: 'tech', tags: 'ai' },
      paramOrigins: { tags: 'proposal' },
      actor: 'agent',
    },
    snapshot,
  );
  snapshot = await execOnline(
    db,
    { rel: 'article-drafting:main', action: 'next', params: { body: '正文' }, actor: 'human' },
    snapshot,
  );
  snapshot = await execOnline(
    db,
    {
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: 'Hello World' },
      actor: 'human',
    },
    snapshot,
  );
  snapshot = await execOnline(
    db,
    { rel: 'comment:c1', action: 'approve', params: {}, actor: 'agent' },
    snapshot,
  );
  return snapshot;
}

const SCENARIO_EVENT_COUNT = 10; // seed 1 + 拒绝 3 + 向导 3 + publish 2(executed+appended)+ approve 1

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
});

describe('I5 重放一致性(真 PG)', () => {
  it('在线终态与 fold(日志重放) 的内容 hash 一致', async () => {
    const online = await runScenario(pool);

    // 重放:从库读全部日志 → fold(fold 无 guard 依赖:重放不裁决,只折叠)。
    const stored = await listEvents(pool);
    expect(stored).toHaveLength(SCENARIO_EVENT_COUNT);
    const replayed = fold(await readLog(pool), { flows });

    const hashOnline = contentVersion(online);
    const hashReplay = contentVersion(replayed);
    expect(hashReplay).toBe(hashOnline);

    // 具体终态抽查(不只信 hash):新文章落位、向导完结、评论过审、出处保留。
    // D24 机械适配:append 合并源实例字段——向导前序步骤落在实例上的
    // category/tags/body 随 publish 并入新文章(origin 各自留痕:tags 为
    // proposal,其余 intent;title 为 publish 参数覆盖同名字段)。
    expect(replayed.instances['post:hello-world']).toEqual({
      rel: 'post:hello-world',
      flow: 'article-drafting',
      node: 'published',
      fields: {
        title: { value: 'Hello World', origin: 'intent' },
        category: { value: 'tech', origin: 'intent' },
        tags: { value: 'ai', origin: 'proposal' },
        body: { value: '正文', origin: 'intent' },
      },
    });
    expect(replayed.instances['article-drafting:main']?.node).toBe('done');
    expect(replayed.instances['comment:c1']?.node).toBe('approved');
    expect(replayed.instances['article-drafting:main']?.fields.tags).toEqual({
      value: 'ai',
      origin: 'proposal',
    });
    expect(replayed.collections).toEqual({
      comments: ['comment:c1'],
      articles: ['post:hello-world'],
    });
  });

  it('拒绝事件留痕带 reason(I6),且不改变折叠结果', async () => {
    const online = await runScenario(pool);
    const stored = await listEvents(pool);

    const rejected = stored.filter((event) => event.kind === 'action-rejected');
    expect(rejected).toHaveLength(3);
    for (const event of rejected) {
      expect(event.reason).toBeTruthy();
    }
    // 三层各占一条:声明层 / guard 层 / schema 层。
    expect(rejected.map((event) => event.reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('未声明'),
        expect.stringContaining('guard 不满足'),
        expect.stringContaining('schema'),
      ]),
    );

    // 拒绝事件不参与状态:把它们从日志剔除后重放,终态 hash 不变。
    const log = await readLog(pool);
    const withoutRejections = log.filter((event) => event.kind !== 'action-rejected');
    expect(contentVersion(fold(withoutRejections, { flows }))).toBe(contentVersion(online));
  });

  it('可重复跑:TRUNCATE 后再来一轮,hash 仍一致且与上轮相同', async () => {
    await runScenario(pool);
    const firstHash = contentVersion(fold(await readLog(pool), { flows }));
    expect(firstHash).toBeTruthy();

    await pool.query('TRUNCATE events');
    const second = await runScenario(pool);
    const secondHash = contentVersion(fold(await readLog(pool), { flows }));
    expect(secondHash).toBe(contentVersion(second));
    expect(secondHash).toBe(firstHash); // 序列确定性:同输入同日志同终态
  });

  it('agent-decision 审计事件(T11 Phase B)混入日志:fold no-op,重放 hash 不变', async () => {
    const online = await runScenario(pool);

    // inline 聊天路径的逐步决策留痕(rel=chat:<sessionId>,detail 五要素)——
    // 经 PG JSONB 往返后 fold 仍须忽略该 kind(纯审计,不改状态)。
    await appendEvent(pool, {
      kind: 'agent-decision',
      rel: 'chat:sess-replay',
      actor: 'agent',
      principal: 'user:sess-replay',
      channel: 'chat',
      detail: {
        step: 1,
        driver: 'rule',
        prompt: {
          goal: { verb: '发布一篇文章' },
          currentRel: 'article-drafting:main',
          entity: { rel: 'article-drafting:main', class: ['flow-instance'], actions: ['next'] },
          blocked: [],
          lastRejection: null,
          successes: [],
        },
        reasoning: null,
        op: { kind: 'exec', action: 'next', params: { title: 'Hello World' } },
      },
    });

    const replayed = fold(await readLog(pool), { flows });
    expect(contentVersion(replayed)).toBe(contentVersion(online));
  });
});
