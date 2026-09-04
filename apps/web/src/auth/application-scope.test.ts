import type { EngineSnapshot } from '@ui4a/shared';
import type { SirenEntity, Sitemap } from '@ui4a/engine';
import { describe, expect, it, vi } from 'vitest';

import {
  assertReachable,
  assertThreadOwner,
  filterEntityForGrantedApplications,
  filterSitemapForPolicyScope,
  filterThreadEntityForPrincipal,
} from './application-scope';
import { businessApplications } from './audience/business-applications';

// D51 新应用注册演练(文末 describe):sidecar 读咽喉 getAuthorizedPresentationResult
// 走真实 engine 边界,这里以 vi.mock 注入 fixture 引擎(纯单元,不触库)。
const authorizedService = vi.hoisted(() => ({
  readSnapshot: vi.fn(),
  getSitemap: vi.fn(),
  getEntity: vi.fn(),
}));

vi.mock('../engine/service', () => ({
  getDb: () => ({ kind: 'test-db' }),
  getEngine: async () => authorizedService,
}));

import { getAuthorizedPresentationResult } from '../engine/presentation/authorized-entity';

const snapshot = {
  instances: {
    'post:p1': { rel: 'post:p1', flow: 'post-status', node: 'published', fields: {} },
    'comment:c1': { rel: 'comment:c1', flow: 'comment-moderation', node: 'pending', fields: {} },
  },
  collections: {
    articles: ['post:p1'],
    comments: ['comment:c1'],
  },
  confirmations: {
    'confirmation:c1': {
      id: 'c1',
      targetRel: 'post:p1',
      targetAction: 'archive',
      proposedBy: { actor: 'agent' },
      status: 'pending',
    },
  },
  definitions: {
    'post-status': {
      name: 'post-status',
      version: 1,
      status: 'active',
      definition: { name: 'post-status', app: 'publishing' },
    },
    'comment-moderation': {
      name: 'comment-moderation',
      version: 1,
      status: 'active',
      definition: { name: 'comment-moderation', app: 'community' },
    },
  },
  activations: {
    'meta/activation:a1': {
      id: 'a1',
      flow: 'post-status',
      version: 2,
      artifact: 'sha256:fixture',
      status: 'pending-approval',
      checks: [],
      requestedBy: { actor: 'human' },
    },
  },
  applications: {
    publishing: { name: 'publishing', title: 'Publishing', intent: 'Publish' },
    community: { name: 'community', title: 'Community', intent: 'Moderate' },
  },
  threads: {
    mine: {
      id: 'mine',
      owner: 'user:mike',
      goal: { text: 'Mine', source: 'message:mine' },
      status: 'open',
      references: { context: [], active: [], approval: [], event: [] },
      recentEventSeqs: [],
    },
    theirs: {
      id: 'theirs',
      owner: 'user:other',
      goal: { text: 'Theirs', source: 'message:theirs' },
      status: 'open',
      references: { context: [], active: [], approval: [], event: [] },
      recentEventSeqs: [],
    },
  },
} as unknown as EngineSnapshot;

const sitemap: Sitemap = {
  version: 'fixture',
  surfaces: [
    { rel: 'articles', title: 'Articles', collection: true, app: 'publishing' },
    { rel: 'comments', title: 'Comments', collection: true, app: 'community' },
    {
      rel: 'threads',
      title: 'Work Threads',
      collection: true,
      scope: 'principal',
      memberRelPrefix: 'thread:',
    },
  ],
  flows: [
    {
      name: 'post-status',
      title: 'Post',
      app: 'publishing',
      initial: 'published',
      nodes: [],
      edges: [],
    },
    {
      name: 'comment-moderation',
      title: 'Comment',
      app: 'community',
      initial: 'pending',
      nodes: [],
      edges: [],
    },
  ],
  applications: [
    {
      rel: 'application:publishing',
      name: 'publishing',
      title: 'Publishing',
      intent: 'Publish',
      flows: [],
    },
    {
      rel: 'application:community',
      name: 'community',
      title: 'Community',
      intent: 'Moderate',
      flows: [],
    },
  ],
  capabilities: [
    {
      name: 'publish',
      title: 'Publish',
      kind: 'effect',
      intent: 'publish',
      scope: { applications: ['publishing'], flows: ['post-status'] },
    },
    {
      name: 'moderate',
      title: 'Moderate',
      kind: 'effect',
      intent: 'moderate',
      scope: { applications: ['community'], flows: ['comment-moderation'] },
    },
  ],
};

const businessContext = { snapshot, sitemap, plane: 'business' as const };
const metaContext = { snapshot, sitemap, plane: 'meta' as const };

describe('audience predicate authorization (D51)', () => {
  it('binds business instances, aliases, collections, and confirmations to their application', () => {
    for (const rel of [
      'application:publishing',
      'post:p1',
      'flow:post-status',
      'articles',
      'confirmation:c1',
    ]) {
      expect(() => assertReachable(businessContext, rel, ['publishing'])).not.toThrow();
    }
    for (const rel of [
      'application:community',
      'comment:c1',
      'flow:comment-moderation',
      'comments',
    ]) {
      expect(() => assertReachable(businessContext, rel, ['publishing'])).toThrowError(
        'scope_insufficient',
      );
    }
  });

  it('grants are set-shaped: any intersection authorizes, disjoint sets deny', () => {
    expect(() =>
      assertReachable(businessContext, 'comments', ['development', 'community']),
    ).not.toThrow();
    expect(() =>
      assertReachable(businessContext, 'comments', ['development', 'governance']),
    ).toThrowError('scope_insufficient');
  });

  it('fail-opens rels without resolvable ownership and hands them to the three-stage judgment', () => {
    // thread:mine 无归属(未知 rel):即使授予集合为空也不由受众谓词拒绝。
    expect(() => assertReachable(businessContext, 'thread:mine', [])).not.toThrow();
  });

  it('binds Meta flow, activation, and application targets to the same application', () => {
    for (const rel of [
      'meta/flow:post-status',
      'meta/activation:a1',
      'meta/application:publishing',
    ]) {
      expect(() => assertReachable(metaContext, rel, ['publishing'])).not.toThrow();
    }
    for (const rel of ['meta/flow:comment-moderation', 'meta/application:community']) {
      expect(() => assertReachable(metaContext, rel, ['publishing'])).toThrowError(
        'scope_insufficient',
      );
    }
  });

  it('keeps business plane visibility meta-free while audience-filtering by grant set', () => {
    const scoped = filterSitemapForPolicyScope(sitemap, 'publishing');
    expect(scoped.surfaces.map(({ rel }) => rel)).toEqual(['articles', 'threads']);
    expect(scoped.flows.map(({ name }) => name)).toEqual(['post-status']);
    expect(scoped.applications.map(({ name }) => name)).toEqual(['publishing']);
    expect(scoped.capabilities.map(({ name }) => name)).toEqual(['publish']);

    const collection: SirenEntity = {
      class: ['collection'],
      properties: { count: 2 },
      actions: [],
      links: [],
      entities: [
        {
          class: ['item'],
          href: '/api/entity?rel=post%3Ap1',
          properties: {},
          actions: [],
          links: [],
        },
        {
          class: ['item'],
          href: '/api/entity?rel=comment%3Ac1',
          properties: {},
          actions: [],
          links: [],
        },
      ],
    };
    const filtered = filterEntityForGrantedApplications(collection, {
      ...businessContext,
      grantedApplications: ['publishing'],
      principal: 'user:mike',
    });
    expect(filtered.entities?.map(({ href }) => href)).toEqual(['/api/entity?rel=post%3Ap1']);
    expect(filtered.properties.count).toBe(1);
  });

  it('treats principal-scoped surfaces as Application-neutral while enforcing trusted ownership', () => {
    // threads 为 principal 持有面,成员不归属任何应用:空授予集也可达。
    expect(() => assertReachable(businessContext, 'threads', [])).not.toThrow();
    expect(() => assertThreadOwner(snapshot, 'thread:mine', 'user:mike')).not.toThrow();
    expect(() => assertThreadOwner(snapshot, 'thread:theirs', 'user:mike')).toThrowError(
      'scope_insufficient',
    );

    const collection: SirenEntity = {
      class: ['collection', 'threads'],
      properties: { rel: 'threads', count: 2 },
      actions: [],
      links: [],
      entities: Object.values(snapshot.threads!).map((thread) => ({
        class: ['work-thread', thread.status],
        properties: { id: thread.id, owner: thread.owner },
        actions: [],
        links: [],
      })),
    };
    const mine = filterThreadEntityForPrincipal(collection, snapshot, 'threads', 'user:mike');
    expect(mine.entities?.map((entity) => entity.properties.id)).toEqual(['mine']);
    expect(mine.properties.count).toBe(1);
  });

  it('derives exact-member ownership from the surface prefix declaration instead of the rel spelling', () => {
    const applicationOwned: Sitemap = {
      ...sitemap,
      surfaces: [
        ...sitemap.surfaces.filter((surface) => surface.rel !== 'threads'),
        {
          rel: 'owned-work',
          title: 'Owned work',
          collection: true,
          scope: 'application',
          app: 'publishing',
          memberRelPrefix: 'thread:',
        },
      ],
    };
    expect(() =>
      assertReachable({ snapshot, sitemap: applicationOwned, plane: 'business' }, 'thread:mine', [
        'publishing',
      ]),
    ).not.toThrow();
    expect(() =>
      assertReachable({ snapshot, sitemap: applicationOwned, plane: 'business' }, 'thread:mine', [
        'community',
      ]),
    ).toThrowError('scope_insufficient');
  });

  it('filters thread members and links through the granted set without dropping dangling refs', () => {
    const thread: SirenEntity = {
      class: ['work-thread', 'open'],
      properties: {
        context: ['articles', 'comments', 'meta/flows'],
        active: [
          { rel: 'post:p1', status: 'published', dangling: false },
          { rel: 'comment:c1', status: 'pending', dangling: false },
          { rel: 'external:missing', dangling: true },
        ],
        approval: [
          { rel: 'confirmation:c1', status: 'pending', dangling: false },
          { rel: 'meta/activation:a1', status: 'pending-approval', dangling: false },
        ],
      },
      actions: [],
      links: [
        { rel: ['self'], href: '/api/entity?rel=thread%3Amine' },
        { rel: ['context'], href: '/api/entity?rel=articles' },
        { rel: ['context'], href: '/api/entity?rel=comments' },
        { rel: ['context'], href: '/api/entity?rel=meta%2Fflows' },
        { rel: ['active'], href: '/api/entity?rel=post%3Ap1' },
        { rel: ['active'], href: '/api/entity?rel=comment%3Ac1' },
        { rel: ['active', 'dangling'], href: '/api/entity?rel=external%3Amissing' },
        { rel: ['approval'], href: '/api/entity?rel=confirmation%3Ac1' },
        { rel: ['approval'], href: '/api/entity?rel=meta%2Factivation%3Aa1' },
      ],
    };
    const filtered = filterEntityForGrantedApplications(thread, {
      ...businessContext,
      grantedApplications: ['publishing'],
      principal: 'user:mike',
    });
    expect(filtered.properties).toMatchObject({
      context: ['articles'],
      active: [
        { rel: 'post:p1', status: 'published', dangling: false },
        { rel: 'external:missing', dangling: true },
      ],
      approval: [{ rel: 'confirmation:c1', status: 'pending', dangling: false }],
    });
    expect(filtered.links.map((link) => link.href)).toEqual([
      '/api/entity?rel=thread%3Amine',
      '/api/entity?rel=articles',
      '/api/entity?rel=post%3Ap1',
      '/api/entity?rel=external%3Amissing',
      '/api/entity?rel=confirmation%3Ac1',
    ]);
  });

  it('strips reference properties by declared principal member family, not by class name', () => {
    // 与 work-thread 同 scope 形状的非 thread 实体:jobs 面声明 scope='principal'
    // + memberRelPrefix='job:',其成员获得与 thread 成员完全同等的引用裁剪。
    const jobsSitemap: Sitemap = {
      ...sitemap,
      surfaces: [
        ...sitemap.surfaces,
        {
          rel: 'jobs',
          title: 'Jobs',
          collection: true,
          scope: 'principal',
          memberRelPrefix: 'job:',
        },
      ],
    };
    const job: SirenEntity = {
      class: ['job'],
      properties: {
        context: ['articles', 'comments'],
        active: [
          { rel: 'post:p1', status: 'published', dangling: false },
          { rel: 'comment:c1', status: 'pending', dangling: false },
        ],
        approval: [
          { rel: 'confirmation:c1', status: 'pending', dangling: false },
          { rel: 'meta/activation:a1', status: 'pending-approval', dangling: false },
        ],
      },
      actions: [],
      links: [{ rel: ['self'], href: '/api/entity?rel=job%3Aj1' }],
    };
    const filtered = filterEntityForGrantedApplications(job, {
      snapshot,
      sitemap: jobsSitemap,
      plane: 'business',
      grantedApplications: ['publishing'],
      principal: 'user:mike',
    });
    expect(filtered.properties).toMatchObject({
      context: ['articles'],
      active: [{ rel: 'post:p1', status: 'published', dangling: false }],
      approval: [{ rel: 'confirmation:c1', status: 'pending', dangling: false }],
    });
  });

  it('does not strip references when no surface declares the member family, even for thread classes', () => {
    // 去类名绑定的反向证明:引用裁剪由 sitemap 声明驱动;没有声明该成员族的
    // sitemap 上,即便实体带 work-thread 类也不做引用属性裁剪。
    const withoutThreadsSurface: Sitemap = {
      ...sitemap,
      surfaces: sitemap.surfaces.filter((surface) => surface.rel !== 'threads'),
    };
    const thread: SirenEntity = {
      class: ['work-thread', 'open'],
      properties: {
        context: ['articles', 'comments'],
        active: [{ rel: 'comment:c1', status: 'pending', dangling: false }],
        approval: [],
      },
      actions: [],
      links: [{ rel: ['self'], href: '/api/entity?rel=thread%3Amine' }],
    };
    const filtered = filterEntityForGrantedApplications(thread, {
      snapshot,
      sitemap: withoutThreadsSurface,
      plane: 'business',
      grantedApplications: ['publishing'],
      principal: 'user:mike',
    });
    expect(filtered.properties.context).toEqual(['articles', 'comments']);
    expect(filtered.properties.active).toEqual([
      { rel: 'comment:c1', status: 'pending', dangling: false },
    ]);
  });

  it('leaves collection entities untouched without injecting absent reference keys', () => {
    const collection: SirenEntity = {
      class: ['collection', 'threads'],
      properties: { rel: 'threads', title: 'Work Threads', count: 0 },
      actions: [],
      links: [{ rel: ['self'], href: '/api/entity?rel=threads' }],
    };
    const filtered = filterEntityForGrantedApplications(collection, {
      ...businessContext,
      grantedApplications: ['publishing'],
      principal: 'user:mike',
    });
    expect(Object.keys(filtered.properties)).toEqual(['rel', 'title', 'count']);
  });
});

// D51 不变量#5 注册演练:向 snapshot 注册假应用 'fixture-app'(含一条 flow 定义
// 归属),不改任何产品代码——受众谓词、实体裁剪、sidecar 三态读结果全部直接生效。
describe('D51-新应用零改码', () => {
  const item = (rel: string): SirenEntity => ({
    class: ['item'],
    href: `/api/entity?rel=${rel}`,
    properties: {},
    actions: [],
    links: [],
  });
  // 注册数据:fixture-app 应用 + fixture-flow 定义归属(flowApplication 读
  // activeDefinitionOf → definitions 条目,故 name/version/status 非必需)。
  const fixtureAppSnapshot = {
    ...snapshot,
    applications: {
      ...snapshot.applications,
      'fixture-app': { name: 'fixture-app', title: 'Fixture', intent: 'fixture' },
    },
    definitions: {
      ...snapshot.definitions,
      'fixture-flow': { definition: { name: 'fixture-flow', app: 'fixture-app' } },
    },
    instances: {
      ...snapshot.instances,
      'fixture:item-1': { rel: 'fixture:item-1', flow: 'fixture-flow', node: 'open', fields: {} },
    },
  } as unknown as EngineSnapshot;
  const fixtureAppSitemap: Sitemap = {
    ...sitemap,
    surfaces: [
      ...sitemap.surfaces,
      { rel: 'fixture-items', title: 'Fixture items', collection: true, app: 'fixture-app' },
    ],
  };
  const fixtureContext = {
    snapshot: fixtureAppSnapshot,
    sitemap: fixtureAppSitemap,
    plane: 'business' as const,
  };

  it('assertReachable 对 fixture-app 注册数据直接生效(含 flow 归属)', () => {
    for (const rel of ['fixture:item-1', 'fixture-items', 'flow:fixture-flow']) {
      expect(() => assertReachable(fixtureContext, rel, ['fixture-app'])).not.toThrow();
      // 授予集合不含 fixture-app → 受众谓词拒绝(mechanical code scope_insufficient;
      // 呈现层映射 reasonCode=audience-unreachable,见 sidecar 三态用例)。
      expect(() => assertReachable(fixtureContext, rel, ['publishing'])).toThrowError(
        'scope_insufficient',
      );
    }
  });

  it('filterEntityForGrantedApplications 按受众集合裁剪 links/entities', () => {
    const collection: SirenEntity = {
      class: ['collection'],
      properties: { count: 2 },
      actions: [],
      links: [
        { rel: ['self'], href: '/api/entity?rel=fixture-items' },
        { rel: ['related'], href: '/api/entity?rel=fixture%3Aitem-1' },
        { rel: ['related'], href: '/api/entity?rel=comment%3Ac1' },
      ],
      entities: [item('fixture%3Aitem-1'), item('comment%3Ac1')],
    };
    const kept = filterEntityForGrantedApplications(collection, {
      ...fixtureContext,
      grantedApplications: ['fixture-app', 'publishing'],
      principal: 'user:mike',
    });
    expect(kept.entities?.map(({ href }) => href)).toEqual(['/api/entity?rel=fixture%3Aitem-1']);
    expect(kept.links.map(({ href }) => href)).toEqual([
      '/api/entity?rel=fixture-items',
      '/api/entity?rel=fixture%3Aitem-1',
    ]);
    expect(kept.properties.count).toBe(1);
  });

  it('sidecar 读咽喉 getAuthorizedPresentationResult 三态对 fixture-app 同步生效', async () => {
    authorizedService.readSnapshot.mockResolvedValue(fixtureAppSnapshot);
    authorizedService.getSitemap.mockReturnValue(fixtureAppSitemap);
    authorizedService.getEntity.mockImplementation(async (rel: string) =>
      rel === 'fixture:item-1'
        ? ({
            class: ['item'],
            properties: { id: rel },
            actions: [],
            links: [],
          } as unknown as SirenEntity)
        : undefined,
    );
    // 授予含 fixture-app → authorized(授予内零可见授权事件);不含 →
    // audience-unreachable;无实体 → subject-unavailable。
    await expect(
      getAuthorizedPresentationResult('fixture:item-1', 'user:mike', ['fixture-app']),
    ).resolves.toMatchObject({ kind: 'authorized' });
    await expect(
      getAuthorizedPresentationResult('fixture:item-1', 'user:mike', ['publishing']),
    ).resolves.toMatchObject({ kind: 'audience-unreachable' });
    await expect(
      getAuthorizedPresentationResult('fixture:none', 'user:mike', ['fixture-app']),
    ).resolves.toMatchObject({ kind: 'subject-unavailable' });
  });
});

// T52 Phase 3(D71.3 反 fail-open):应用停用的 fold 级联会删 applications 键,
// 但 deprecatedApplications 审计表在场、同 app 定义/实例条目保留(app 字段在)。
// 受众归属解析必须双集化(active ∪ deprecated):停用应用的事实解析出非空归属,
// 咽喉对「授予集合无交集」给出确定性拒绝;空受众 fail-open 只保留给从未安装/
// 无法归属的 rel(D51 语义本身不变)。
describe('停用应用受众双集解析(T52 P3 / D71.3)', () => {
  // P1 级联后的快照形状:publishing 被停用——applications 删键、审计表留痕、
  // post-status 条目置 status:'deprecated'(键与 app 字段保留)、实例保留。
  const deprecatedSnapshot = {
    ...snapshot,
    applications: { community: (snapshot.applications as Record<string, unknown>).community },
    deprecatedApplications: {
      publishing: { name: 'publishing', reason: 'T52 P3 fixture', seq: 42 },
    },
    definitions: {
      ...snapshot.definitions,
      'post-status': {
        ...(snapshot.definitions as Record<string, { status?: string }>)['post-status'],
        status: 'deprecated',
      },
    },
  } as unknown as EngineSnapshot;
  const deprecatedBusiness = {
    snapshot: deprecatedSnapshot,
    sitemap,
    plane: 'business' as const,
  };
  const deprecatedMeta = { snapshot: deprecatedSnapshot, sitemap, plane: 'meta' as const };
  const item = (rel: string): SirenEntity => ({
    class: ['item'],
    href: `/api/entity?rel=${rel}`,
    properties: {},
    actions: [],
    links: [],
  });

  it('business application: 停用名经双集解析出非空归属:无交集拒绝,授予内放行', () => {
    // 最窄纯边界:解析函数本身返回停用名(而非 [])。
    expect(businessApplications(deprecatedSnapshot, sitemap, 'application:publishing')).toEqual([
      'publishing',
    ]);
    // 咽喉:授予集合(治理展开后亦不含停用名)无交集 → 结构化拒绝。
    expect(() =>
      assertReachable(deprecatedBusiness, 'application:publishing', [
        'community',
        'default',
        'governance',
      ]),
    ).toThrowError('scope_insufficient');
    // 停用名仍在凭证授予集合内 → 不由受众谓词拒绝(授予内零可见授权事件)。
    expect(() =>
      assertReachable(deprecatedBusiness, 'application:publishing', ['publishing']),
    ).not.toThrow();
  });

  it('meta application: 同一双集口径(meta/application: 不因停用变空受众)', () => {
    expect(() =>
      assertReachable(deprecatedMeta, 'meta/application:publishing', ['community', 'governance']),
    ).toThrowError('scope_insufficient');
    expect(() =>
      assertReachable(deprecatedMeta, 'meta/application:publishing', ['publishing']),
    ).not.toThrow();
  });

  it('从未安装/无法归属的 rel 维持 D51 fail-open(空受众兜底只属于这一类)', () => {
    expect(() =>
      assertReachable(deprecatedBusiness, 'application:never-installed', []),
    ).not.toThrow();
    expect(() =>
      assertReachable(deprecatedMeta, 'meta/application:never-installed', []),
    ).not.toThrow();
  });

  it('停用应用的 flow:/实例/确认/集合面归属保持非空(级联保留 app 字段,只钉不改)', () => {
    for (const rel of ['flow:post-status', 'post:p1', 'confirmation:c1', 'articles']) {
      expect(() => assertReachable(deprecatedBusiness, rel, ['community'])).toThrowError(
        'scope_insufficient',
      );
      expect(() => assertReachable(deprecatedBusiness, rel, ['publishing'])).not.toThrow();
    }
  });

  it('集合成员过滤:停用应用成员被逐子裁剪,活跃成员保留', () => {
    const collection: SirenEntity = {
      class: ['collection'],
      properties: { count: 2 },
      actions: [],
      links: [],
      entities: [item('application%3Apublishing'), item('application%3Acommunity')],
    };
    const filtered = filterEntityForGrantedApplications(collection, {
      ...deprecatedBusiness,
      grantedApplications: ['community'],
      principal: 'user:mike',
    });
    expect(filtered.entities?.map(({ href }) => href)).toEqual([
      '/api/entity?rel=application%3Acommunity',
    ]);
    expect(filtered.properties.count).toBe(1);
  });
});
