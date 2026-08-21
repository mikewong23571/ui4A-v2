/**
 * rule driver 决策器单测(T2 Phase D / Task D2):
 *
 * 目标相关性决策次序(arch-brief §5 原样,每层带停止条件):
 * ①点名的资源(links/子实体里出现 → navigate 直达;已在目标上 → 停止本层)
 * ②点名的动作(goal.verb 与 action name/title 词级交集 → exec)
 * ③相关节点上的流程推进词(向导 next / 队列逐条 approve / 队列成员回集合)
 * ④自由漫游(沿 links 走到与目标有交集处;无交集可走 → fail)
 * done 判定:完成类动作成功过(发布=publish 成功;下线=目标 rel 上 unpublish 成功;
 * 审核=队列无剩余待处理且 ≥1 次 approve 成功)。
 * 拒绝即数据:guard/undeclared 拒后换路径;schema 拒后按 schema 默认值字段自救(最多一次)。
 */
import type { SirenAction, SirenEntity } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { runAgent } from './loop';
import { createRuleDriver } from './rule-driver';
import {
  collectionEntity,
  createScriptedTransport,
  emptyFieldsSchema,
  execUrl,
  instanceEntity,
  jsonResponse,
} from './testkit';
import type { AgentGoal, AgentOperation, DriverContext, RejectionRecord, TrailStep } from './types';

const BASE = 'http://contract.test';

// ---- 夹具:与种子域投影同形 -------------------------------------------------

function action(name: string, title: string, fields?: Record<string, unknown>): SirenAction {
  return { name, title, method: 'POST', href: '/api/exec', fields: fields ?? emptyFieldsSchema() };
}

const titleSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
  additionalProperties: false,
};

const classificationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['tech', 'essay', 'review'] },
    tags: { type: 'string' },
  },
  required: ['category'],
  additionalProperties: false,
};

const contentSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: { body: { type: 'string', format: 'textarea' } },
  required: ['body'],
  additionalProperties: false,
};

const articles = collectionEntity({
  rel: 'articles',
  members: [
    {
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'published',
      fields: { title: '欢迎来到 UI4A' },
    },
    { rel: 'post:first-post', flow: 'post-status', node: 'published', fields: { title: '第一篇' } },
  ],
});

const postWelcome = instanceEntity({
  rel: 'post:post-welcome',
  flow: 'post-status',
  node: 'published',
  collection: 'articles',
  actions: [action('unpublish', '下线'), action('archive', '归档')],
});

const comments = collectionEntity({
  rel: 'comments',
  members: [
    {
      rel: 'comment:c1',
      flow: 'comment-moderation',
      node: 'pending',
      actions: [action('approve', '通过'), action('reject', '驳回')],
    },
    {
      rel: 'comment:c2',
      flow: 'comment-moderation',
      node: 'pending',
      actions: [action('approve', '通过'), action('reject', '驳回')],
    },
    {
      rel: 'comment:c3',
      flow: 'comment-moderation',
      node: 'pending',
      actions: [action('approve', '通过'), action('reject', '驳回')],
    },
    { rel: 'comment:c4', flow: 'comment-moderation', node: 'approved' },
  ],
});

const commentC1Pending = instanceEntity({
  rel: 'comment:c1',
  flow: 'comment-moderation',
  node: 'pending',
  collection: 'comments',
  actions: [action('approve', '通过'), action('reject', '驳回')],
});

const commentC1Approved = instanceEntity({
  rel: 'comment:c1',
  flow: 'comment-moderation',
  node: 'approved',
  collection: 'comments',
});

const wizardBasicInfo = instanceEntity({
  rel: 'article-drafting:main',
  flow: 'article-drafting',
  node: 'basic-info',
  actions: [action('next', '下一步', titleSchema)],
});

const wizardClassification = instanceEntity({
  rel: 'article-drafting:main',
  flow: 'article-drafting',
  node: 'classification',
  actions: [action('next', '下一步', classificationSchema)],
});

const wizardContent = instanceEntity({
  rel: 'article-drafting:main',
  flow: 'article-drafting',
  node: 'content',
  actions: [action('next', '完成编辑', contentSchema)],
});

const wizardReady = instanceEntity({
  rel: 'article-drafting:main',
  flow: 'article-drafting',
  node: 'ready',
  actions: [action('publish', '发布', titleSchema)],
});

const wizardDone = instanceEntity({
  rel: 'article-drafting:main',
  flow: 'article-drafting',
  node: 'done',
});

function decide(
  entity: SirenEntity,
  goal: AgentGoal,
  extras: {
    trail?: TrailStep[];
    successes?: DriverContext['successes'];
    lastRejection?: RejectionRecord;
    sitemap?: DriverContext['sitemap'];
  } = {},
): AgentOperation {
  const driver = createRuleDriver();
  const currentRel =
    typeof entity.properties.rel === 'string' && entity.properties.rel !== ''
      ? entity.properties.rel
      : 'articles';
  return driver.decide({
    goal,
    currentRel,
    entity,
    trail: extras.trail ?? [],
    successes: extras.successes ?? [],
    lastRejection: extras.lastRejection,
    sitemap: extras.sitemap,
    // rule driver 的 decide 是同步实现(接口允许 Promise 是为 LLM driver);
    // 断言理由:此处构造的正是 createRuleDriver。
  }) as AgentOperation;
}

function rejectedStep(
  rel: string,
  opAction: string,
  params: Record<string, unknown> | undefined,
  layer: string,
  reason: string,
): TrailStep {
  return {
    step: 1,
    rel,
    op: { kind: 'exec', action: opAction, params },
    outcome: 'rejected',
    rejection: { rel, action: opAction, params, layer, reason },
  };
}

// ---- ①点名的资源 ----------------------------------------------------------

describe('①点名的资源(navigate 直达)', () => {
  it('resource 出现在子实体 → navigate 直达(B2 开局)', () => {
    const op = decide(articles, { verb: '下线', resource: 'post-welcome' });
    expect(op).toEqual({ kind: 'navigate', rel: 'post:post-welcome' });
  });

  it('targetRel 精确匹配子实体 rel → navigate', () => {
    const op = decide(articles, { verb: '下线', targetRel: 'post:post-welcome' });
    expect(op).toEqual({ kind: 'navigate', rel: 'post:post-welcome' });
  });

  it('停止条件:已在点名资源上 → 不再 navigate,落入②', () => {
    const op = decide(postWelcome, { verb: '下线', resource: 'post-welcome' });
    expect(op.kind).toBe('exec');
  });

  it('①优先于②:当前实体有词交集动作,但点名资源在别处 → 仍 navigate', () => {
    const entityWithBoth: SirenEntity = {
      ...postWelcome,
      entities: [
        {
          ...instanceEntity({ rel: 'post:other-post', flow: 'post-status', node: 'published' }),
          rel: ['item'],
          href: '/api/entity?rel=post%3Aother-post',
        },
      ],
    };
    const op = decide(entityWithBoth, { verb: '下线', resource: 'other-post' });
    expect(op).toEqual({ kind: 'navigate', rel: 'post:other-post' });
  });
});

// ---- ②点名的动作 ----------------------------------------------------------

describe('②点名的动作(词级交集 → exec)', () => {
  it('中文动词经词表/标题匹配英文动作名', () => {
    const op = decide(postWelcome, { verb: '下线' });
    expect(op).toEqual({ kind: 'exec', action: 'unpublish', params: {} });
  });

  it('params 从 goal.fields 按 schema 属性过滤(多余字段会被 additionalProperties 拒)', () => {
    const op = decide(wizardReady, {
      verb: '发布',
      fields: { title: '第三篇', category: 'tech', irrelevant: true },
    });
    expect(op).toEqual({ kind: 'exec', action: 'publish', params: { title: '第三篇' } });
  });

  it('schema 默认值可补缺失字段(goal.fields 未覆盖时)', () => {
    const withDefault = instanceEntity({
      rel: 'article-drafting:main',
      flow: 'article-drafting',
      node: 'basic-info',
      actions: [
        action('next', '下一步', {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { title: { type: 'string', default: '草稿' } },
          required: ['title'],
          additionalProperties: false,
        }),
      ],
    });
    const op = decide(withDefault, { verb: '发布' });
    expect(op).toEqual({ kind: 'exec', action: 'next', params: { title: '草稿' } });
  });

  it('guard-results 标记 blocked 的动作不选(拒绝即教育)', () => {
    const blocked = instanceEntity({
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'published',
      collection: 'articles',
      actions: [action('unpublish', '下线'), action('archive', '归档')],
      guardResults: [
        { action: 'unpublish', blocked: true, reason: 'guard 不满足: is-published=false' },
      ],
    });
    const op = decide(blocked, { verb: '下线' });
    expect(op.kind).not.toBe('exec');
  });

  it('guard-failed 拒绝后换路径:同 (rel,action) 不再直投(B2 目标场景)', () => {
    const op = decide(
      postWelcome,
      { verb: '下线', resource: 'post-welcome' },
      {
        lastRejection: {
          rel: 'post:post-welcome',
          action: 'unpublish',
          layer: 'guard-failed',
          reason: 'guard 不满足: is-published=false',
        },
      },
    );
    expect(op.kind).toBe('fail');
  });
});

// ---- ③相关节点上的流程推进词 ------------------------------------------------

describe('③流程推进(向导 next / 队列逐条)', () => {
  it('向导推进:goal.fields 按当前步 schema 过滤后 exec next(三步各异)', () => {
    const fields = { title: 'T', category: 'tech', tags: 'a', body: 'B' };
    expect(decide(wizardBasicInfo, { verb: '发布', fields })).toEqual({
      kind: 'exec',
      action: 'next',
      params: { title: 'T' },
    });
    expect(decide(wizardClassification, { verb: '发布', fields })).toEqual({
      kind: 'exec',
      action: 'next',
      params: { category: 'tech', tags: 'a' },
    });
    expect(decide(wizardContent, { verb: '发布', fields })).toEqual({
      kind: 'exec',
      action: 'next',
      params: { body: 'B' },
    });
  });

  it('队列推进:集合上选第一个声明目标动作的成员,c4(无动作)被跳过', () => {
    const op = decide(comments, { verb: '审核' });
    expect(op).toEqual({ kind: 'navigate', rel: 'comment:c1' });
  });

  it('队列成员处理完 → 沿 collection 回链回队列视图', () => {
    const op = decide(commentC1Approved, { verb: '审核' });
    expect(op).toEqual({ kind: 'navigate', rel: 'comments' });
  });

  it('待处理成员自身:②直接命中 approve(词表桥)', () => {
    const op = decide(commentC1Pending, { verb: '审核' });
    expect(op).toEqual({ kind: 'exec', action: 'approve', params: {} });
  });
});

// ---- ④自由漫游 ------------------------------------------------------------

describe('④自由漫游(沿 links 走到有交集处)', () => {
  it('无①②③可走时,navigate 到与目标有词交集的链接 rel', () => {
    const hub = instanceEntity({
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'published',
    });
    // 只有 links(无子实体):手工加两条导航链接
    const entity: SirenEntity = {
      ...hub,
      links: [
        ...hub.links,
        { rel: ['related'], href: '/api/entity?rel=post%3Atarget-post' },
        { rel: ['related'], href: '/api/entity?rel=post%3Aunrelated' },
      ],
    };
    const op = decide(entity, { verb: '下线', resource: 'target-post' });
    expect(op).toEqual({ kind: 'navigate', rel: 'post:target-post' });
  });

  it('无任何可导航路径且无动作 → fail(停止条件)', () => {
    const op = decide(wizardDone, { verb: '审核' });
    expect(op.kind).toBe('fail');
  });

  it('sitemap surfaces:目标词命中表面标题且入口在 links 上 → 沿入口进入(零特权导航)', () => {
    const articles = collectionEntity({
      rel: 'articles',
      members: [
        { rel: 'post:post-welcome', flow: 'post-status', node: 'published' },
      ],
    });
    const entity: SirenEntity = {
      ...articles,
      links: [
        ...articles.links,
        { rel: ['flow'], href: '/api/entity?rel=flow%3Aarticle-drafting' },
      ],
    };
    const op = decide(entity, { verb: '发布' }, {
      sitemap: {
        version: 'v1',
        surfaces: [
          { rel: 'flow:article-drafting', title: '文章发布向导' },
          { rel: 'flow:post-status', title: '文章状态' },
        ],
        applications: [],
      },
    });
    // 目标"发布"与表面标题"文章发布向导"词级交集 → 进入 flow 入口链接
    expect(op).toEqual({ kind: 'navigate', rel: 'flow:article-drafting' });
  });

  it('sitemap 命中但入口不在当前实体 links 上 → 不据此导航(退回普通漫游)', () => {
    const articles = collectionEntity({
      rel: 'articles',
      members: [
        { rel: 'post:post-welcome', flow: 'post-status', node: 'published' },
      ],
    });
    const op = decide(articles, { verb: '发布' }, {
      sitemap: {
        version: 'v1',
        surfaces: [{ rel: 'flow:article-drafting', title: '文章发布向导' }],
        applications: [],
      },
    });
    // articles 上无 flow 入口链接也无词交集链接 → fail(不幻觉导航)
    expect(op.kind).toBe('fail');
  });
});

// ---- done 判定 --------------------------------------------------------------

describe('done 判定(完成类动作成功过,相对目标)', () => {
  it('发布:publish 成功过且当前无剩余目标相关动作 → done', () => {
    const op = decide(
      wizardDone,
      { verb: '发布' },
      { successes: [{ rel: 'article-drafting:main', action: 'publish', params: { title: 'T' } }] },
    );
    expect(op).toEqual({ kind: 'done', summary: expect.stringContaining('publish') });
  });

  it('尚未成功过 → 不 done(ready 节点继续 exec publish)', () => {
    const op = decide(wizardReady, { verb: '发布', fields: { title: 'T' } });
    expect(op).toEqual({ kind: 'exec', action: 'publish', params: { title: 'T' } });
  });

  it('下线:目标 rel 上 unpublish 成功 → done;成功在别的 rel 上 → 不 done', () => {
    const goal = { verb: '下线', resource: 'post-welcome' } satisfies AgentGoal;
    const offlinePost = instanceEntity({
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'offline',
      collection: 'articles',
      actions: [action('republish', '重新发布')],
    });
    const done = decide(offlinePost, goal, {
      successes: [{ rel: 'post:post-welcome', action: 'unpublish' }],
    });
    expect(done.kind).toBe('done');

    const notDone = decide(offlinePost, goal, {
      successes: [{ rel: 'post:first-post', action: 'unpublish' }],
    });
    expect(notDone.kind).not.toBe('done');
  });

  it('审核:队列仍有待处理成员 → 不 done,继续点名下一个;清零且成功过 → done', () => {
    const goal = { verb: '审核' } satisfies AgentGoal;
    const stillPending = decide(comments, goal, {
      successes: [{ rel: 'comment:c1', action: 'approve' }],
    });
    expect(stillPending).toEqual({ kind: 'navigate', rel: 'comment:c2' });

    const allApproved = collectionEntity({
      rel: 'comments',
      members: [
        { rel: 'comment:c1', flow: 'comment-moderation', node: 'approved' },
        { rel: 'comment:c2', flow: 'comment-moderation', node: 'approved' },
        { rel: 'comment:c3', flow: 'comment-moderation', node: 'approved' },
        { rel: 'comment:c4', flow: 'comment-moderation', node: 'approved' },
      ],
    });
    const done = decide(allApproved, goal, {
      successes: [{ rel: 'comment:c1', action: 'approve' }],
    });
    expect(done.kind).toBe('done');
  });

  it('审核 done 必须在队列视图上判定:成员实体上不 done(先回集合)', () => {
    const op = decide(
      commentC1Approved,
      { verb: '审核' },
      { successes: [{ rel: 'comment:c1', action: 'approve' }] },
    );
    expect(op).toEqual({ kind: 'navigate', rel: 'comments' });
  });
});

// ---- 拒绝即数据:字段级自救(最多一次)--------------------------------------

describe('schema 拒绝后的字段自救', () => {
  const rescueSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      title: { type: 'string', default: '草稿标题' },
      category: { type: 'string', enum: ['tech', 'essay'] },
    },
    required: ['title', 'category'],
    additionalProperties: false,
  };
  const wizardRescue = instanceEntity({
    rel: 'article-drafting:main',
    flow: 'article-drafting',
    node: 'basic-info',
    actions: [action('next', '下一步', rescueSchema)],
  });

  it('schema-invalid 拒绝 → 按 schema 默认值(缺省时枚举首项)补齐重试', () => {
    const op = decide(
      wizardRescue,
      { verb: '发布' },
      {
        lastRejection: {
          rel: 'article-drafting:main',
          action: 'next',
          params: {},
          layer: 'schema-invalid',
          reason: '参数不符合动作字段 schema',
        },
      },
    );
    expect(op).toEqual({
      kind: 'exec',
      action: 'next',
      params: { title: '草稿标题', category: 'tech' },
    });
  });

  it('自救只允许一次:同一 (rel,action) 第二次 schema 拒绝 → 放弃该动作', () => {
    const trail: TrailStep[] = [
      rejectedStep('article-drafting:main', 'next', {}, 'schema-invalid', '第一次'),
      rejectedStep(
        'article-drafting:main',
        'next',
        { title: '草稿标题', category: 'tech' },
        'schema-invalid',
        '第二次',
      ),
    ];
    const op = decide(
      wizardRescue,
      { verb: '发布' },
      {
        trail,
        lastRejection: trail[1]!.rejection,
      },
    );
    expect(op.kind).not.toBe('exec');
  });
});

// ---- 循环握手:rule driver × runAgent(B2 微缩全链路)-----------------------

describe('rule driver 与循环握手(B2 微缩)', () => {
  it('articles 出发:子实体直达 → exec unpublish → done', async () => {
    const entities: Record<string, SirenEntity> = {
      articles,
      'post:post-welcome': postWelcome,
    };
    const transport = createScriptedTransport((url, init) => {
      if (init?.method === 'POST') {
        // unpublish 成功后实体进入 offline(带 republish 动作)
        entities['post:post-welcome'] = instanceEntity({
          rel: 'post:post-welcome',
          flow: 'post-status',
          node: 'offline',
          collection: 'articles',
          actions: [action('republish', '重新发布')],
        });
        return jsonResponse({ entity: entities['post:post-welcome'] });
      }
      const rel = new URL(url).searchParams.get('rel') ?? '';
      const entity = entities[rel];
      return entity !== undefined
        ? jsonResponse(entity)
        : jsonResponse({ error: `实体 "${rel}" 不存在` }, 404);
    });

    const result = await runAgent(
      createRuleDriver(),
      { verb: '下线', resource: 'post-welcome' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        startRel: 'articles',
        principal: 'mike',
      },
    );

    expect(result.outcome).toBe('done');
    expect(result.steps[0]!.op).toEqual({ kind: 'navigate', rel: 'post:post-welcome' });
    expect(result.steps[1]!.op).toEqual({ kind: 'exec', action: 'unpublish', params: {} });
    expect(transport.calls.find((call) => call.url === execUrl(BASE))!.body).toMatchObject({
      rel: 'post:post-welcome',
      action: 'unpublish',
      actor: 'agent',
      principal: 'mike',
    });
  });
});
