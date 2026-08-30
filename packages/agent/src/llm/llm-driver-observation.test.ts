import { readFileSync } from 'node:fs';

import type { SirenAction } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { buildUserPrompt } from './llm-driver';
import { instanceEntity } from '../testkit/testkit';
import type { DriverContext } from '../types';

const nextAction: SirenAction = {
  name: 'next',
  title: '下一步',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { title: { type: 'string', title: '标题' } },
    required: ['title'],
    additionalProperties: false,
  },
};

const baseEntity = instanceEntity({
  rel: 'article-drafting:main',
  flow: 'article-drafting',
  node: 'basic-info',
  actions: [nextAction],
  collection: 'articles',
});

function context(overrides: Partial<DriverContext> = {}): DriverContext {
  return {
    goal: { verb: '发布一篇文章', fields: { title: '测试标题' } },
    currentRel: 'article-drafting:main',
    entity: baseEntity,
    trail: [],
    successes: [],
    ...overrides,
  };
}

describe('授权合同观察进入 LLM prompt', () => {
  it('当前实体由 presentation 声明的 properties.fields 正文可见', () => {
    const entity = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: {
        title: '第一篇',
        body: '这是第一篇完整文章，用来验证具体查看、正文阅读和跨刷新恢复链路。',
      },
    });
    entity.properties.presentation = {
      version: 1,
      fields: [
        {
          path: 'properties.fields.body',
          title: '正文',
          role: 'primary-content',
        },
      ],
    };
    const prompt = buildUserPrompt(
      context({
        currentRel: 'post:first-post',
        entity,
        observations: [{ rel: 'post:first-post', entity }],
      }),
    );

    expect(prompt).toContain('这是第一篇完整文章');
    expect(prompt).toContain('"fields"');
    expect(prompt).toContain('"body"');
  });

  it('每次决定只看到当前实体的认知投影，不累积旧实体正文', () => {
    const first = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: { title: '第一篇', body: '第一篇正文' },
    });
    const welcome = instanceEntity({
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'published',
      fields: { title: '欢迎', body: '欢迎正文' },
    });
    welcome.properties.presentation = {
      version: 1,
      fields: [
        {
          path: 'properties.fields.body',
          title: '正文',
          role: 'primary-content',
        },
      ],
    };
    const prompt = buildUserPrompt(
      context({
        currentRel: 'post:post-welcome',
        entity: welcome,
        observations: [
          { rel: 'post:first-post', entity: first },
          { rel: 'post:post-welcome', entity: welcome },
        ],
      }),
    );

    expect(prompt).not.toContain('第一篇正文');
    expect(prompt).toContain('欢迎正文');
    expect(prompt).not.toContain('post:first-post');
    expect(prompt).toContain('post:post-welcome');
  });

  it('重启续跑只需当前 node 与结构化成功引用，不回放旧快照或 exec 参数', () => {
    const oldEntity = instanceEntity({
      rel: 'article-drafting:main',
      flow: 'article-drafting',
      node: 'basic-info',
      fields: { title: 'OLD_WIZARD_INPUT_MUST_NOT_RETURN' },
    });
    const currentEntity = instanceEntity({
      rel: 'article-drafting:main',
      flow: 'article-drafting',
      node: 'ready',
      actions: [
        {
          ...nextAction,
          name: 'publish',
          title: '发布',
        },
      ],
    });
    const prompt = buildUserPrompt(
      context({
        currentRel: 'article-drafting:main',
        entity: currentEntity,
        observations: [
          { rel: 'article-drafting:main', entity: oldEntity },
          { rel: 'article-drafting:main', entity: currentEntity },
        ],
        trail: [
          {
            step: 1,
            rel: 'article-drafting:main',
            op: {
              kind: 'exec',
              action: 'next',
              params: { title: 'VERBOSE_EXEC_PARAMS_MUST_NOT_RETURN' },
            },
            outcome: 'executed',
            entity: {
              rel: 'article-drafting:main',
              class: ['flow-instance', 'article-drafting'],
              node: 'ready',
              actions: ['publish'],
            },
          },
        ],
      }),
    );

    expect(prompt).toContain('"node": "ready"');
    expect(prompt).toContain('"action": "next"');
    expect(prompt).toContain('"result"');
    expect(prompt).not.toContain('OLD_WIZARD_INPUT_MUST_NOT_RETURN');
    expect(prompt).not.toContain('VERBOSE_EXEC_PARAMS_MUST_NOT_RETURN');
  });

  it('prompt 同时披露目标约束、facts/links/actions/guards 与 app-bounded capability/action 处境', () => {
    const entity = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: { title: '第一篇', body: '正文' },
      actions: [nextAction],
      collection: 'articles',
    });
    const prompt = buildUserPrompt(
      context({
        currentRel: 'post:first-post',
        entity,
        observations: [{ rel: 'post:first-post', entity }],
        conversation: {
          activeGoal: { verb: '保存摘要', targetRel: 'post:first-post' },
          focus: { currentRel: 'post:first-post' },
          referents: [],
          constraints: [{ text: '不要发布', sourceMessageId: 'm1' }],
        },
        app: 'publishing',
        sitemap: {
          version: 'v-capability',
          surfaces: [{ rel: 'articles', title: '文章集合' }],
          applications: [
            {
              name: 'publishing',
              intent: '内容发布',
              flows: [
                {
                  name: 'post-status',
                  title: '文章状态',
                  actions: [
                    { name: 'feature', title: '新激活动作', node: 'published', guards: [] },
                  ],
                },
              ],
            },
          ],
          capabilities: [
            {
              name: 'draft',
              title: '工件起草',
              kind: 'extract',
              intent: '生成候选草稿',
              input: '文章字段 schema',
              output: '候选草稿',
              inputSchema: { type: 'object', required: ['body'] },
              outputSchema: { type: 'object', required: ['summary'] },
              scope: { applications: ['publishing'], flows: ['post-status'] },
            },
          ],
        },
      }),
    );

    expect(prompt).toContain('不要发布');
    expect(prompt).toContain('"fields"');
    expect(prompt).toContain('"links"');
    expect(prompt).toContain('"actions"');
    expect(prompt).toContain('"guard-results"');
    expect(prompt).toContain('"feature"');
    expect(prompt).toContain('"draft"');
    expect(prompt).toContain('"scope"');
    expect(prompt).not.toContain('"inputSchema"');
    expect(prompt).not.toContain('"outputSchema"');
  });

  it('认知投影复用封闭 V1 词表并删除同层视觉策略', () => {
    const entity = instanceEntity({
      rel: 'comment:cognitive',
      flow: 'comment-moderation',
      node: 'pending',
      fields: { body: '待审核内容' },
    });
    entity.properties.presentation = {
      version: 1,
      traits: ['human-responsibility'],
      groupRole: 'responsibility',
      priority: 'high',
      emptyMeaning: 'no-current-responsibility',
      fields: [
        {
          path: 'properties.fields.body',
          title: '评论正文',
          role: 'primary-content',
          overview: true,
        },
      ],
      layout: 'VISUAL_LAYOUT_MUST_NOT_REACH_PROVIDER',
      component: 'VISUAL_COMPONENT_MUST_NOT_REACH_PROVIDER',
      unknownFutureKey: 'UNKNOWN_PRESENTATION_MUST_NOT_REACH_PROVIDER',
    } as never;

    const prompt = buildUserPrompt(context({ currentRel: 'comment:cognitive', entity }));

    expect(prompt).toContain('"version": 1');
    expect(prompt).toContain('"human-responsibility"');
    expect(prompt).toContain('"groupRole": "responsibility"');
    expect(prompt).toContain('"priority": "high"');
    expect(prompt).toContain('"emptyMeaning": "no-current-responsibility"');
    expect(prompt).toContain('"role": "primary-content"');
    expect(prompt).not.toContain('VISUAL_LAYOUT_MUST_NOT_REACH_PROVIDER');
    expect(prompt).not.toContain('VISUAL_COMPONENT_MUST_NOT_REACH_PROVIDER');
    expect(prompt).not.toContain('UNKNOWN_PRESENTATION_MUST_NOT_REACH_PROVIDER');
  });

  it('非法 cognition 整体 fail closed，独立 T38 filters 声明继续披露', () => {
    const entity = instanceEntity({
      rel: 'comments',
      flow: 'comment-moderation',
      node: 'pending',
      fields: { body: '仍由字段合同读取' },
    });
    entity.properties.presentation = {
      version: 1,
      traits: ['UNDECLARED_COGNITIVE_TRAIT_MUST_NOT_REACH_PROVIDER'],
      fields: [
        {
          path: 'properties.fields.body',
          title: 'INVALID_COGNITION_FIELD_MUST_NOT_REACH_PROVIDER',
          role: 'primary-content',
        },
      ],
      filters: [
        {
          field: 'status',
          title: '状态',
          values: [{ value: 'pending', title: '待处理' }],
        },
      ],
    } as never;

    const prompt = buildUserPrompt(context({ currentRel: 'comments', entity }));

    expect(prompt).toContain('"filters"');
    expect(prompt).toContain('"field": "status"');
    expect(prompt).not.toContain('UNDECLARED_COGNITIVE_TRAIT_MUST_NOT_REACH_PROVIDER');
    expect(prompt).not.toContain('INVALID_COGNITION_FIELD_MUST_NOT_REACH_PROVIDER');
  });

  it('动态 action/capability 发现不在 system prompt 中硬编码故事动作名', () => {
    const source = readFileSync(new URL('./llm-driver.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('action_feature');
    expect(source).not.toContain('action_generate-summary');
    expect(source).not.toContain('capability:summarize');
  });
});
