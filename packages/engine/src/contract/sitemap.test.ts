import { describe, expect, it } from 'vitest';

import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
} from '../core/fixtures';
import { activeDefinitionOf, definitionSeedEvent } from '../definition/meta';
import { fold, type LogEvent } from '../projection/fold';
import { deriveSitemap } from './sitemap';
import type { ApplicationDefinition, CapabilityDefinition, FlowDefinition } from '../core/types';

const flows = [articleDraftingFlow, postStatusFlow, commentModerationFlow];

describe('deriveSitemap — 结构', () => {
  it('flows 拓扑:节点(名称/标题)与边(from/action/to)完整', () => {
    const sitemap = deriveSitemap(flows);
    const postStatus = sitemap.flows.find((flow) => flow.name === 'post-status');
    expect(postStatus).toMatchObject({
      name: 'post-status',
      title: '文章状态',
      initial: 'published',
    });
    expect(postStatus?.nodes.map((node) => `${node.name}:${node.title}`)).toEqual([
      'published:已发布',
      'offline:已下线',
      'archived:已归档',
    ]);
    expect(postStatus?.edges).toEqual([
      { from: 'published', action: 'unpublish', to: 'offline' },
      { from: 'published', action: 'archive', to: 'archived' },
    ]);
  });

  it('节点 action 摘要:name/title/method/to/guards/fields schema', () => {
    const sitemap = deriveSitemap(flows);
    const classification = sitemap.flows
      .find((flow) => flow.name === 'article-drafting')
      ?.nodes.find((node) => node.name === 'classification');
    expect(classification?.actions[0]).toMatchObject({
      name: 'next',
      title: '下一步',
      method: 'POST',
      to: 'content',
      guards: [],
    });
    expect(classification?.actions[0].fields).toMatchObject({
      type: 'object',
      required: ['category'],
    });
    const approve = sitemap.flows
      .find((flow) => flow.name === 'comment-moderation')
      ?.nodes[0].actions.find((action) => action.name === 'approve');
    expect(approve?.guards).toEqual(['is-pending']);
  });

  it('requires-confirmation 进 action 摘要(策略标注可被发现)', () => {
    const sitemap = deriveSitemap(flows);
    const archive = sitemap.flows
      .find((flow) => flow.name === 'post-status')
      ?.nodes[0].actions.find((action) => action.name === 'archive');
    expect(archive?.['requires-confirmation']).toBe('high');
  });

  it('surfaces 界面清单:flow 定义实体 + append 目标集合(去重)', () => {
    const sitemap = deriveSitemap(flows);
    expect(sitemap.surfaces).toEqual(
      expect.arrayContaining([
        { rel: 'flow:article-drafting', title: '文章发布向导', app: 'default' },
        { rel: 'flow:post-status', title: '文章状态', app: 'default' },
        { rel: 'articles', title: 'articles', collection: true, pageable: true, app: 'default' },
      ]),
    );
    const articlesSurfaces = sitemap.surfaces.filter((s) => s.rel === 'articles');
    expect(articlesSurfaces).toHaveLength(1);
  });

  it('extraSurfaces 附加额外资源面(种子域的 comments 集合无 append 来源)', () => {
    const sitemap = deriveSitemap(flows, {
      extraSurfaces: [{ rel: 'comments', title: '评论队列', collection: true }],
    });
    expect(sitemap.surfaces).toEqual(
      expect.arrayContaining([{ rel: 'comments', title: '评论队列', collection: true }]),
    );
  });

  it('keeps a principal-scoped surface Application-neutral without synthesizing app ownership', () => {
    const sitemap = deriveSitemap(flows, {
      extraSurfaces: [
        {
          rel: 'threads',
          title: 'Work Threads',
          collection: true,
          scope: 'principal',
          memberRelPrefix: 'thread:',
        },
      ],
    });
    expect(sitemap.surfaces.find((surface) => surface.rel === 'threads')).toEqual({
      rel: 'threads',
      title: 'Work Threads',
      collection: true,
      scope: 'principal',
      memberRelPrefix: 'thread:',
    });
  });

  it('generatedAt 透传可选;缺省不出现', () => {
    expect(deriveSitemap(flows).generatedAt).toBeUndefined();
    expect(deriveSitemap(flows, { generatedAt: '2026-08-21T00:00:00Z' }).generatedAt).toBe(
      '2026-08-21T00:00:00Z',
    );
  });
});

describe('deriveSitemap — 版本号(内容 hash 短码,缓存键)', () => {
  it('同内容同版本(深拷贝等价)', () => {
    const a = deriveSitemap(flows);
    const b = deriveSitemap(JSON.parse(JSON.stringify(flows)));
    expect(b.version).toBe(a.version);
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('键序无关(canonical JSON 排序):同内容不同插入序同版本;数组序是内容', () => {
    const reordered: FlowDefinition = {
      initial: 'published',
      name: 'post-status',
      nodes: [
        {
          actions: [
            { title: '下线', to: 'offline', name: 'unpublish' },
            { to: 'archived', title: '归档', name: 'archive', 'requires-confirmation': 'high' },
          ],
          name: 'published',
          title: '已发布',
        },
        { actions: [], name: 'offline', title: '已下线' },
        { actions: [], name: 'archived', title: '已归档' },
      ],
      title: '文章状态',
    };
    const a = deriveSitemap([postStatusFlow]);
    const b = deriveSitemap([reordered]);
    expect(b.version).toBe(a.version);

    const swappedActions = JSON.parse(JSON.stringify(postStatusFlow));
    swappedActions.nodes[0].actions.reverse();
    expect(deriveSitemap([swappedActions]).version).not.toBe(a.version);
  });

  it('内容变化 → 版本变化', () => {
    const a = deriveSitemap(flows);
    const mutated = JSON.parse(JSON.stringify(flows));
    mutated[1].nodes[0].actions[0].title = '下线(已改)';
    const b = deriveSitemap(mutated);
    expect(b.version).not.toBe(a.version);
  });

  it('surfaces 变化 → 版本变化(缓存键覆盖界面清单)', () => {
    const a = deriveSitemap(flows);
    const b = deriveSitemap(flows, {
      extraSurfaces: [{ rel: 'comments', title: '评论队列', collection: true }],
    });
    expect(b.version).not.toBe(a.version);
  });
});

describe('deriveSitemap — application 分组投影(T10 Phase C,spec 架构决定 5)', () => {
  /** 活跃 app 定义表(snapshot.applications 的形状;声明序 = 投影序)。 */
  const applications: Record<string, ApplicationDefinition> = {
    default: { name: 'default', title: '默认应用', intent: '归一化兜底' },
    publishing: {
      name: 'publishing',
      title: '内容发布',
      intent: '内容起草与发布',
      entry: { target: 'flow:article-drafting', role: 'primary-create' },
    },
    community: { name: 'community', title: '社区互动', intent: '评论与社区互动' },
  };
  /** 带归属的 flow(fixture 本体不带 app,此处声明 membership)。 */
  const appFlows: FlowDefinition[] = [
    { ...articleDraftingFlow, app: 'publishing' },
    { ...postStatusFlow, app: 'publishing' },
    { ...commentModerationFlow, app: 'community' },
  ];

  it('applications 分组:name/title/intent 齐全,flow 按其 app 归组(声明序)', () => {
    const sitemap = deriveSitemap(appFlows, { applications });
    expect(sitemap.applications.map((app) => app.name)).toEqual([
      'default',
      'publishing',
      'community',
    ]);
    const publishing = sitemap.applications.find((app) => app.name === 'publishing');
    expect(publishing).toMatchObject({
      name: 'publishing',
      title: '内容发布',
      intent: '内容起草与发布',
      entry: { target: 'flow:article-drafting', role: 'primary-create' },
    });
    // 组内 flows 保持扁平表声明序,且与扁平条目同形状(同一投影)。
    expect(publishing?.flows.map((flow) => flow.name)).toEqual(['article-drafting', 'post-status']);
    expect(publishing?.flows[0]).toEqual(
      sitemap.flows.find((flow) => flow.name === 'article-drafting'),
    );
    // 无成员的 app 定义也在场(intent 是发现层第一层依据,不因空成员缺席)。
    expect(sitemap.applications.find((app) => app.name === 'default')).toMatchObject({
      name: 'default',
      flows: [],
    });
  });

  it('无归属 flow(app 缺省)归一化落 default 组', () => {
    const sitemap = deriveSitemap(flows, { applications });
    const defaultApp = sitemap.applications.find((app) => app.name === 'default');
    expect(defaultApp?.flows.map((flow) => flow.name)).toEqual([
      'article-drafting',
      'post-status',
      'comment-moderation',
    ]);
  });

  it('扁平 flows 条目带 app(向后兼容:既有字段不变,缺省归一化 default)', () => {
    const sitemap = deriveSitemap(appFlows, { applications });
    expect(sitemap.flows.map((flow) => `${flow.name}:${flow.app}`)).toEqual([
      'article-drafting:publishing',
      'post-status:publishing',
      'comment-moderation:community',
    ]);
    const normalized = deriveSitemap(flows, { applications });
    expect(normalized.flows.every((flow) => flow.app === 'default')).toBe(true);
  });

  it('surfaces 条目带 app:flow 面取其 flow.app;集合 owner 由声明或 append 推导', () => {
    const sitemap = deriveSitemap(appFlows, {
      applications,
      extraSurfaces: [{ rel: 'comments', title: '评论队列', collection: true }],
    });
    expect(sitemap.surfaces).toEqual(
      expect.arrayContaining([
        { rel: 'flow:article-drafting', title: '文章发布向导', app: 'publishing' },
        { rel: 'flow:comment-moderation', title: '评论审核', app: 'community' },
        { rel: 'articles', title: 'articles', collection: true, pageable: true, app: 'publishing' },
        // extraSurfaces 无声明 owner 时保持 Application-neutral。
        { rel: 'comments', title: '评论队列', collection: true },
      ]),
    );
  });

  it('app 定义内容变更(intent 改动)→ version 变化(纯推导免费获得的 bump)', () => {
    const a = deriveSitemap(appFlows, { applications });
    const changed = deriveSitemap(appFlows, {
      applications: {
        ...applications,
        publishing: { ...applications.publishing, intent: '内容起草与发布(改)' },
      },
    });
    expect(changed.version).not.toBe(a.version);
  });

  it('无 app 定义的快照(applications 缺省)→ applications 为空数组,不炸', () => {
    const sitemap = deriveSitemap(flows);
    expect(sitemap.applications).toEqual([]);
    // 扁平投影照常:flows/surfaces 归一化 app='default',version 照常产出。
    expect(sitemap.flows.map((flow) => flow.app)).toEqual(['default', 'default', 'default']);
    expect(sitemap.version).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('deriveSitemap — 动态 capability 处境(T15 U14/U17)', () => {
  const applications: Record<string, ApplicationDefinition> = {
    publishing: { name: 'publishing', title: '内容发布', intent: '发布内容' },
    community: { name: 'community', title: '社区互动', intent: '审核评论' },
  };
  const capabilities: Record<string, CapabilityDefinition> = {
    draft: {
      name: 'draft',
      title: '工件起草',
      kind: 'extract',
      intent: '根据字段语义生成候选草稿',
      input: '字段 schema 与当前实例',
      output: '候选草稿工件',
    },
    moderate: {
      name: 'moderate',
      title: '评论风险识别',
      kind: 'transform',
      intent: '识别评论风险并生成审核建议',
      input: '评论工件',
      output: '审核建议工件',
    },
  };
  const publishing = { ...articleDraftingFlow, app: 'publishing' };
  const community = structuredClone({ ...commentModerationFlow, app: 'community' });
  community.nodes[0]!.actions[0]!.effect = {
    type: 'spawn',
    capability: 'moderate',
  };

  it('注册能力以完整定义摘要进入 sitemap，并从 flow 引用推导 app/flow scope', () => {
    const sitemap = deriveSitemap([publishing, community], { applications, capabilities });

    expect(sitemap.capabilities).toEqual([
      {
        name: 'draft',
        title: '工件起草',
        kind: 'extract',
        intent: '根据字段语义生成候选草稿',
        input: '字段 schema 与当前实例',
        output: '候选草稿工件',
        scope: { applications: ['publishing'], flows: ['article-drafting'] },
      },
      {
        name: 'moderate',
        title: '评论风险识别',
        kind: 'transform',
        intent: '识别评论风险并生成审核建议',
        input: '评论工件',
        output: '审核建议工件',
        scope: { applications: ['community'], flows: ['comment-moderation'] },
      },
    ]);
  });

  it('新增 capability 数据无需改 prompt 即改变下一份 sitemap 内容与版本', () => {
    const before = deriveSitemap([publishing], {
      applications,
      capabilities: { draft: capabilities.draft! },
    });
    const after = deriveSitemap([publishing, community], { applications, capabilities });

    expect(before.capabilities.map((capability) => capability.name)).toEqual(['draft']);
    expect(after.capabilities.map((capability) => capability.name)).toEqual(['draft', 'moderate']);
    expect(after.version).not.toBe(before.version);
  });

  it('旧调用方不提供 capability 定义时保持兼容：字段存在但为空', () => {
    expect(deriveSitemap([publishing], { applications }).capabilities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T52 Phase 3:停用应用的全联动收缩(引擎级钉测)。
//
// 数据源结论:deriveSitemap 参数驱动(flows/applications/capabilities 全由
// 调用方注入,引擎不直读 snapshot.definitions)。service 链路(service.ts
// activeFlowList 过滤 deprecated + snapshot.applications 已被 fold 删键)已
// 完成收缩;本组钉测把「fold 折叠出停用态 → 按 service 同一口径组装 →
// deriveSitemap 扁平面/分组不含停用物」的语义钉在引擎层,防组装口径回退。
// ---------------------------------------------------------------------------
describe('deriveSitemap — T52 停用联动收缩(引擎级钉测)', () => {
  const defaultApp: ApplicationDefinition = {
    name: 'default',
    title: '默认应用',
    intent: '无归属 flow 的兜底归组',
  };
  const publishingApp: ApplicationDefinition = {
    name: 'publishing',
    title: '内容发布',
    intent: '内容起草与发布',
    entry: { target: 'flow:post-status', role: 'primary-task' },
  };

  /** publishing 专属 flow:spawn 引用 'draft'(仅停用侧)与 'moderate'(双侧)。 */
  const publishingFlow: FlowDefinition = structuredClone({
    ...postStatusFlow,
    app: 'publishing',
  });
  publishingFlow.nodes[0]!.actions[0]!.effect = { type: 'spawn', capability: 'draft' };
  publishingFlow.nodes[0]!.actions[1]!.effect = { type: 'spawn', capability: 'moderate' };
  /** default 侧 flow:spawn 引用 'moderate'(双侧共享,收缩后 scope 保 default)。 */
  const defaultFlow: FlowDefinition = structuredClone(commentModerationFlow);
  defaultFlow.nodes[0]!.actions[0]!.effect = { type: 'spawn', capability: 'moderate' };

  const capabilities: Record<string, CapabilityDefinition> = {
    draft: { name: 'draft', title: '工件起草', kind: 'extract', intent: '生成候选草稿' },
    moderate: { name: 'moderate', title: '内容审核', kind: 'transform', intent: '识别内容风险' },
  };

  /** 完整场景日志:两 app 种子 + 两 capability 种子 + 两 flow 种子 + 停用 publishing。 */
  const log: LogEvent[] = [
    {
      seq: 1,
      kind: 'application-seeded',
      rel: 'meta/application:default',
      detail: { name: 'default', definition: defaultApp },
    },
    {
      seq: 2,
      kind: 'application-seeded',
      rel: 'meta/application:publishing',
      detail: { name: 'publishing', definition: publishingApp },
    },
    {
      seq: 3,
      kind: 'capability-seeded',
      rel: 'meta/capability:draft',
      detail: { name: 'draft', definition: capabilities.draft! },
    },
    {
      seq: 4,
      kind: 'capability-seeded',
      rel: 'meta/capability:moderate',
      detail: { name: 'moderate', definition: capabilities.moderate! },
    },
    definitionSeedEvent(5, publishingFlow),
    definitionSeedEvent(6, defaultFlow),
    {
      seq: 7,
      kind: 'application-deprecated',
      rel: 'meta/application:publishing',
      action: 'deprecate',
      actor: 'human',
      principal: 'user:mike',
      detail: { name: 'publishing', commandId: 'cmd:t52-sitemap-pin' },
    },
  ];

  /** service.ts activeFlowList 同源组装口径:deprecated 条目退出活跃注册表。 */
  function activeFlowListOf(snapshot: ReturnType<typeof fold>): FlowDefinition[] {
    return Object.entries(snapshot.definitions ?? {}).flatMap(([name, entry]) => {
      if (entry.status === 'deprecated') return [];
      const active = activeDefinitionOf(snapshot, name);
      return active === undefined ? [] : [active];
    });
  }

  it('fold 前置锚:同 app 条目级联置废、applications 删键(收缩输入即真相)', () => {
    const snapshot = fold(log, { flows: flowRegistry(publishingFlow, defaultFlow) });
    expect(snapshot.definitions?.['post-status']?.status).toBe('deprecated');
    expect(snapshot.definitions?.['comment-moderation']?.status).toBe('active');
    expect(Object.keys(snapshot.applications ?? {})).toEqual(['default']);
  });

  it('扁平面三分量 + applications 分组不含停用物;未停用侧不受波及', () => {
    const snapshot = fold(log, { flows: flowRegistry(publishingFlow, defaultFlow) });
    const sitemap = deriveSitemap(activeFlowListOf(snapshot), {
      applications: snapshot.applications,
      capabilities: snapshot.capabilities,
    });

    // 扁平 flows:停用 app 的 flow 退出,其余 flow 保留。
    expect(sitemap.flows.map((flow) => flow.name)).toEqual(['comment-moderation']);
    // surfaces:停用 flow 面与停用 application 面缺席;活跃侧照常在场。
    const surfaceRels = sitemap.surfaces.map((surface) => surface.rel);
    expect(surfaceRels).not.toContain('flow:post-status');
    expect(surfaceRels).not.toContain('application:publishing');
    expect(surfaceRels).toContain('flow:comment-moderation');
    expect(surfaceRels).toContain('application:default');
    // applications 分组:停用应用出局,活跃应用组内只剩活跃成员。
    expect(sitemap.applications.map((app) => app.name)).toEqual(['default']);
    expect(sitemap.applications[0]?.flows.map((flow) => flow.name)).toEqual(['comment-moderation']);
  });

  it('capability 目录保留条目,scope 收缩:停用侧引用退出,共享 capability 保活跃侧', () => {
    const snapshot = fold(log, { flows: flowRegistry(publishingFlow, defaultFlow) });
    const sitemap = deriveSitemap(activeFlowListOf(snapshot), {
      applications: snapshot.applications,
      capabilities: snapshot.capabilities,
    });

    const draft = sitemap.capabilities.find((capability) => capability.name === 'draft');
    const moderate = sitemap.capabilities.find((capability) => capability.name === 'moderate');
    // 仅被停用 flow 引用的 capability:scope 收缩为空(≠ 授予全局 scope)。
    expect(draft?.scope).toEqual({ applications: [], flows: [] });
    // 双侧共享的 capability:停用侧退出,活跃侧保留。
    expect(moderate?.scope).toEqual({ applications: ['default'], flows: ['comment-moderation'] });
    // 全目录无任何 scope 残留停用应用名。
    expect(
      sitemap.capabilities.flatMap((capability) => capability.scope.applications),
    ).not.toContain('publishing');
  });
});
