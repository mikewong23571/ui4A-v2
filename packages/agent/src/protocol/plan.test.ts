import { describe, expect, it } from 'vitest';

import { deriveSitemap, parseFlowDefinition } from '@ui4a/engine';
import type { FlowDefinition, Sitemap } from '@ui4a/engine';

import { buildPlanPrompt, parsePlanResponse, planFor } from './plan';
import type { AgentGoal } from '../types';

// plan 生成器(T6 Phase A Task 3 / spec 架构决定 4):
// - planFor(goal, sitemap) 纯函数:发布类(向导型)目标 → 从 sitemap flow 形状
//   确定性推导步序列(next×N 带 goal.fields 分步 + 完成动作);非向导目标/
//   无完成动作 → undefined(调用方回退既有逐步循环——plan 是旁路能力);
// - buildPlanPrompt / parsePlanResponse:LLM plan 模式接口(prompt 构造纯函数 +
//   模型 JSON 输出解析;真实调用留 e2e 可选,mock 单测);
// - 不改 runAgent 既有循环。

/** 与 web 种子域同形状的向导 flow(publish 带独立 title 字段与循环 to)。 */
const articleDrafting = parseFlowDefinition({
  name: 'article-drafting',
  title: '文章发布向导',
  initial: 'basic-info',
  nodes: [
    {
      name: 'basic-info',
      title: '基本信息',
      fields: [{ name: 'title', type: 'text', required: true, semantics: 'intent' }],
      actions: [
        { name: 'next', title: '下一步', to: 'classification' },
        { name: 'abandon', title: '放弃', to: 'done' },
      ],
    },
    {
      name: 'classification',
      title: '分类',
      fields: [
        {
          name: 'category',
          type: 'select',
          required: true,
          options: ['tech', 'essay', 'review'],
          semantics: 'org-standard',
        },
        { name: 'tags', type: 'text', semantics: 'intent' },
      ],
      actions: [{ name: 'next', title: '下一步', to: 'content' }],
    },
    {
      name: 'content',
      title: '正文',
      fields: [{ name: 'body', type: 'textarea', required: true, semantics: 'work-product' }],
      actions: [{ name: 'next', title: '完成编辑', to: 'ready' }],
    },
    {
      name: 'ready',
      title: '就绪',
      actions: [
        {
          name: 'publish',
          title: '发布',
          to: 'basic-info',
          guards: ['title-not-taken'],
          fields: [{ name: 'title', type: 'text', required: true, semantics: 'intent' }],
        },
      ],
    },
    { name: 'done', title: '完成', actions: [] },
  ],
} satisfies FlowDefinition);

const postStatus = parseFlowDefinition({
  name: 'post-status',
  title: '文章状态',
  initial: 'published',
  nodes: [
    {
      name: 'published',
      title: '已发布',
      actions: [
        { name: 'unpublish', title: '下线', to: 'offline' },
        { name: 'archive', title: '归档', to: 'archived', 'requires-confirmation': 'high' },
      ],
    },
    { name: 'offline', title: '已下线', actions: [] },
    { name: 'archived', title: '已归档', actions: [] },
  ],
} satisfies FlowDefinition);

const commentModeration = parseFlowDefinition({
  name: 'comment-moderation',
  title: '评论审核',
  initial: 'pending',
  nodes: [
    {
      name: 'pending',
      title: '待处理',
      actions: [{ name: 'approve', title: '通过', to: 'approved' }],
    },
    { name: 'approved', title: '已通过', actions: [] },
  ],
} satisfies FlowDefinition);

const sitemap: Sitemap = deriveSitemap([articleDrafting, postStatus, commentModeration]);

const publishGoal: AgentGoal = {
  verb: '发布',
  fields: { title: 'New Article', category: 'tech', tags: 'ui4a', body: '正文内容' },
};

describe('planFor — 向导型目标的确定性推导', () => {
  it('发布目标 → next×3 分步带 fields + publish,rel 为 flow 别名', () => {
    const proposal = planFor(publishGoal, sitemap);
    expect(proposal).toBeDefined();
    expect(proposal!.flow).toBe('article-drafting');
    expect(proposal!.steps).toEqual([
      { rel: 'flow:article-drafting', action: 'next', params: { title: 'New Article' } },
      { rel: 'flow:article-drafting', action: 'next', params: { category: 'tech', tags: 'ui4a' } },
      { rel: 'flow:article-drafting', action: 'next', params: { body: '正文内容' } },
      { rel: 'flow:article-drafting', action: 'publish', params: { title: 'New Article' } },
    ]);
    expect(proposal!.summary).toContain('article-drafting');
  });

  it('确定性:同输入两次推导 deep equal', () => {
    expect(planFor(publishGoal, sitemap)).toEqual(planFor(publishGoal, sitemap));
  });

  it('字段分步只取该步 schema 声明的字段(不发明事实;缺省字段不补)', () => {
    const partial = planFor(
      { verb: '发布', fields: { title: 'Only Title', body: '只有正文' } },
      sitemap,
    );
    expect(partial!.steps).toEqual([
      { rel: 'flow:article-drafting', action: 'next', params: { title: 'Only Title' } },
      { rel: 'flow:article-drafting', action: 'next', params: {} },
      { rel: 'flow:article-drafting', action: 'next', params: { body: '只有正文' } },
      { rel: 'flow:article-drafting', action: 'publish', params: { title: 'Only Title' } },
    ]);
  });

  it('非向导目标(下线)→ undefined:无向导 flow 命中,调用方回退逐步循环', () => {
    expect(planFor({ verb: '下线' }, sitemap)).toBeUndefined();
  });

  it('目标命中 flow 但非向导形状(无推进步)→ undefined(审核走队列逐步循环)', () => {
    // 「审核」命中 comment-moderation(title 评论审核),但该 flow 无推进动作链,
    // 计划生成器不冒充队列计划。
    expect(planFor({ verb: '审核' }, sitemap)).toBeUndefined();
  });

  it('目标命中向导但终点无完成动作 → undefined', () => {
    const noPublish = deriveSitemap([
      parseFlowDefinition({
        name: 'article-drafting',
        title: '文章发布向导',
        initial: 'a',
        nodes: [
          { name: 'a', title: 'A', actions: [{ name: 'next', title: '下一步', to: 'b' }] },
          { name: 'b', title: 'B', actions: [] },
        ],
      } satisfies FlowDefinition),
    ]);
    expect(planFor(publishGoal, noPublish)).toBeUndefined();
  });

  it('abandon 等非推进动作不进计划(推进词表过滤)', () => {
    const proposal = planFor(publishGoal, sitemap);
    const actions = proposal!.steps.map((step) => step.action);
    expect(actions).not.toContain('abandon');
  });
});

describe('buildPlanPrompt — LLM plan 模式 prompt 构造', () => {
  it('含目标、flow 名与动作清单;确定性', () => {
    const prompt = buildPlanPrompt(publishGoal, sitemap);
    expect(prompt).toContain('New Article');
    expect(prompt).toContain('article-drafting');
    expect(prompt).toContain('publish');
    expect(prompt).toContain('steps');
    expect(buildPlanPrompt(publishGoal, sitemap)).toBe(prompt);
  });

  it('指示 JSON 输出协议(exec-plan 步形状)', () => {
    const prompt = buildPlanPrompt(publishGoal, sitemap);
    expect(prompt).toMatch(/JSON/);
    expect(prompt).toMatch(/"steps"/);
    expect(prompt).toMatch(/rel/);
    expect(prompt).toMatch(/action/);
  });
});

describe('parsePlanResponse — 模型 JSON 计划解析(mock)', () => {
  it('裸 JSON → steps', () => {
    const parsed = parsePlanResponse(
      JSON.stringify({
        steps: [
          { rel: 'flow:article-drafting', action: 'next', params: { title: 'T' } },
          { rel: 'flow:article-drafting', action: 'publish' },
        ],
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      steps: [
        { rel: 'flow:article-drafting', action: 'next', params: { title: 'T' } },
        { rel: 'flow:article-drafting', action: 'publish', params: {} },
      ],
    });
  });

  it('代码围栏 JSON(```json …```)→ steps', () => {
    const parsed = parsePlanResponse(
      '前置说明\n```json\n{"steps":[{"rel":"comment:c1","action":"approve"}]}\n```\n后置说明',
    );
    expect(parsed).toEqual({
      ok: true,
      steps: [{ rel: 'comment:c1', action: 'approve', params: {} }],
    });
  });

  it('非 JSON → {ok:false, error}', () => {
    expect(parsePlanResponse('我觉得这个目标无法完成')).toMatchObject({ ok: false });
    expect(parsePlanResponse('{broken json')).toMatchObject({ ok: false });
  });

  it('steps 非数组 / 缺 rel/action / params 非对象 → {ok:false, error}', () => {
    expect(parsePlanResponse('{"steps":"nope"}')).toMatchObject({ ok: false });
    expect(parsePlanResponse('{"steps":[{"action":"next"}]}')).toMatchObject({ ok: false });
    expect(parsePlanResponse('{"steps":[{"rel":"a"}]}')).toMatchObject({ ok: false });
    expect(
      parsePlanResponse('{"steps":[{"rel":"a","action":"next","params":"nope"}]}'),
    ).toMatchObject({ ok: false });
  });

  it('空 steps 数组是形状错误(合同层拒绝空计划)', () => {
    expect(parsePlanResponse('{"steps":[]}')).toMatchObject({ ok: false });
  });
});
