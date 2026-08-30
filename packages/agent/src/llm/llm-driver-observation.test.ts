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

  it('动态 action/capability 发现不在 system prompt 中硬编码故事动作名', () => {
    const source = readFileSync(new URL('./llm-driver.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('action_feature');
    expect(source).not.toContain('action_generate-summary');
    expect(source).not.toContain('capability:summarize');
  });
});
