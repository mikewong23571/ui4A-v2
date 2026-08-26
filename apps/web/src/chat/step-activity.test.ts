/**
 * step 帧活动数据(T24 Phase B Task 2)服务端投影测试:TrailStep + sitemap
 * 标题 → 结构化 {op, title?, subject?}(呈现接线层,不改 trail.ts 机器文本)。
 *
 * 口径:
 * - op = AgentOperation kind 原样(agent 协议词表,零翻译零分支);
 * - navigate 标题:sitemap surfaces 的合同标题,flow 实例退 sitemap 流程标题,
 *   再退 rel(合同标识,诚实可达,不发明标题);
 * - exec 标题:flow 边(from→to)按"动作迁移进入的节点"精确解析动作标题
 *   (TrailStep.entity 是动作后实体;无实体/无 sitemap/歧义时退动作名);
 * - present subject:字符串原样,selection 以「、」联结;
 * - answer/clarify/exec-plan/done/fail:仅 op(内容经 final.summary 呈现)。
 */
import { describe, expect, it } from 'vitest';

import type { FetchLike, TrailStep } from '@ui4a/agent';

import {
  readSitemapTitles,
  sitemapTitlesFromSummary,
  stepActivityData,
  type SitemapTitles,
} from './step-activity';

const SITEMAP = {
  version: 'v1',
  surfaces: [
    { rel: 'articles', title: '文章列表' },
    { rel: 'flow:article-drafting', title: '文章发布向导' },
  ],
  flows: [
    {
      name: 'article-drafting',
      title: '文章发布向导',
      nodes: [
        { name: 'basic-info', title: '基本信息', actions: [{ name: 'next', title: '下一步' }] },
        {
          name: 'classification',
          title: '分类',
          actions: [{ name: 'next', title: '下一步' }],
        },
        { name: 'content', title: '正文', actions: [{ name: 'next', title: '完成编辑' }] },
        { name: 'ready', title: '就绪', actions: [{ name: 'publish', title: '发布' }] },
      ],
      edges: [
        { from: 'basic-info', action: 'next', to: 'classification' },
        { from: 'classification', action: 'next', to: 'content' },
        { from: 'content', action: 'next', to: 'ready' },
        { from: 'ready', action: 'publish', to: 'ready' },
      ],
    },
  ],
} as const;

const TITLES: SitemapTitles = {
  surfaces: new Map([
    ['articles', '文章列表'],
    ['flow:article-drafting', '文章发布向导'],
  ]),
  flows: [
    {
      name: 'article-drafting',
      title: '文章发布向导',
      nodes: new Map([
        ['basic-info', new Map([['next', '下一步']])],
        ['classification', new Map([['next', '下一步']])],
        ['content', new Map([['next', '完成编辑']])],
        ['ready', new Map([['publish', '发布']])],
      ]),
      edges: [
        { from: 'basic-info', action: 'next', to: 'classification' },
        { from: 'classification', action: 'next', to: 'content' },
        { from: 'content', action: 'next', to: 'ready' },
        { from: 'ready', action: 'publish', to: 'ready' },
      ],
    },
  ],
};

function step(partial: Partial<TrailStep> & Pick<TrailStep, 'op'>): TrailStep {
  return {
    step: 1,
    rel: 'articles',
    outcome: 'navigated',
    ...partial,
  } as TrailStep;
}

describe('stepActivityData(TrailStep → 结构化活动数据)', () => {
  it('navigate:sitemap surfaces 的合同标题', () => {
    const data = stepActivityData(
      step({ op: { kind: 'navigate', rel: 'articles' }, outcome: 'navigated' }),
      TITLES,
    );
    expect(data).toEqual({ op: 'navigate', title: '文章列表' });
  });

  it('navigate:flow 实例(非 surface)退 sitemap 流程标题', () => {
    const data = stepActivityData(
      step({
        op: { kind: 'navigate', rel: 'article-drafting:main' },
        outcome: 'navigated',
        entity: {
          rel: 'article-drafting:main',
          class: ['flow-instance', 'article-drafting'],
          actions: [],
        },
      }),
      TITLES,
    );
    expect(data).toEqual({ op: 'navigate', title: '文章发布向导' });
  });

  it('navigate:无 sitemap/无匹配 → rel 兜底(不发明标题)', () => {
    const data = stepActivityData(
      step({ op: { kind: 'navigate', rel: 'post:first-post' }, outcome: 'navigated' }),
      undefined,
    );
    expect(data).toEqual({ op: 'navigate', title: 'post:first-post' });
  });

  it('exec:动作后节点经边精确解析(content→ready 的 next 是「完成编辑」)', () => {
    const data = stepActivityData(
      step({
        op: { kind: 'exec', action: 'next' },
        outcome: 'executed',
        rel: 'article-drafting:main',
        entity: {
          rel: 'article-drafting:main',
          class: ['flow-instance', 'article-drafting'],
          node: 'ready',
          actions: [],
        },
      }),
      TITLES,
    );
    expect(data).toEqual({ op: 'exec', title: '完成编辑' });
  });

  it('exec:basic-info→classification 的 next 是「下一步」(同名动作不串标题)', () => {
    const data = stepActivityData(
      step({
        op: { kind: 'exec', action: 'next' },
        outcome: 'executed',
        rel: 'article-drafting:main',
        entity: {
          rel: 'article-drafting:main',
          class: ['flow-instance', 'article-drafting'],
          node: 'classification',
          actions: [],
        },
      }),
      TITLES,
    );
    expect(data).toEqual({ op: 'exec', title: '下一步' });
  });

  it('exec:无实体/无 sitemap → 动作名兜底', () => {
    const data = stepActivityData(
      step({ op: { kind: 'exec', action: 'unpublish' }, outcome: 'executed' }),
      undefined,
    );
    expect(data).toEqual({ op: 'exec', title: 'unpublish' });
  });

  it('present:subject 字符串原样;selection 以「、」联结', () => {
    expect(
      stepActivityData(
        step({ op: { kind: 'present', subject: '文章列表', intent: '阅读', delivery: 'auto' } }),
        TITLES,
      ),
    ).toEqual({ op: 'present', subject: '文章列表' });
    expect(
      stepActivityData(
        step({
          op: {
            kind: 'present',
            subject: { selection: ['post:a', 'post:b'] },
            intent: '对比',
            delivery: 'inline',
          },
        }),
        TITLES,
      ),
    ).toEqual({ op: 'present', subject: 'post:a、post:b' });
  });

  it('answer/clarify/exec-plan/done/fail:仅 op,内容不进活动数据', () => {
    expect(
      stepActivityData(step({ op: { kind: 'answer', content: '共 3 篇', sources: [] } }), TITLES),
    ).toEqual({ op: 'answer' });
    expect(
      stepActivityData(
        step({ op: { kind: 'clarify', question: '标题是什么?', continuation: { verb: 'x' } } }),
        TITLES,
      ),
    ).toEqual({ op: 'clarify' });
    expect(
      stepActivityData(
        step({ op: { kind: 'exec-plan', steps: [{ rel: 'r', action: 'a' }] } }),
        TITLES,
      ),
    ).toEqual({ op: 'exec-plan' });
    expect(stepActivityData(step({ op: { kind: 'done', summary: '已完成' } }), TITLES)).toEqual({
      op: 'done',
    });
    expect(stepActivityData(step({ op: { kind: 'fail', reason: '模型不可用' } }), TITLES)).toEqual({
      op: 'fail',
    });
  });
});

describe('readSitemapTitles(合同 sitemap → 标题投影)', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('解析 surfaces 与 flows(节点动作标题 + 边);不可得时返回 undefined', async () => {
    const ok: FetchLike = async () => jsonResponse(SITEMAP);
    const titles = await readSitemapTitles('http://contract.test', ok);
    expect(titles?.surfaces.get('articles')).toBe('文章列表');
    const flow = titles?.flows.find((candidate) => candidate.name === 'article-drafting');
    expect(flow?.nodes.get('content')?.get('next')).toBe('完成编辑');
    expect(flow?.edges).toHaveLength(4);

    const failed: FetchLike = async () => jsonResponse({ error: 'x' }, 500);
    await expect(readSitemapTitles('http://contract.test', failed)).resolves.toBeUndefined();
  });

  it('从已解析 SitemapSummary 纯投影标题，保留同一版本的动作边映射', () => {
    const summary = {
      version: 'summary-v2',
      surfaces: [{ rel: 'articles', title: '摘要文章列表' }],
      applications: [],
      capabilities: [],
      flows: [
        {
          name: 'article-drafting',
          title: '摘要发布向导',
          actions: [{ name: 'next', title: '摘要完成编辑', node: 'content', guards: [] }],
          edges: [{ from: 'content', action: 'next', to: 'ready' }],
        },
      ],
    };

    const titles = sitemapTitlesFromSummary(summary);

    expect(titles?.surfaces.get('articles')).toBe('摘要文章列表');
    expect(titles?.flows[0]?.title).toBe('摘要发布向导');
    expect(titles?.flows[0]?.nodes.get('content')?.get('next')).toBe('摘要完成编辑');
    expect(titles?.flows[0]?.edges).toEqual([{ from: 'content', action: 'next', to: 'ready' }]);
  });
});
