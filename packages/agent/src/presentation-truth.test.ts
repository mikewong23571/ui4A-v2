import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, buildUserPrompt } from './llm-driver';
import { buildRenderPrompt, type BuildRenderPromptInput } from './render';
import { instanceEntity } from './testkit';
import { buildToolProjection } from './tools';
import type { DriverContext } from './types';

function source(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('T16 presentation capability truth governance', () => {
  it('product Chat prompt and tool projection contain no obsolete render-unavailable claim', () => {
    for (const content of [buildSystemPrompt(), source('./tools.ts')]) {
      expect(content).not.toMatch(/render\s*(仍|尚)?未实现|禁止调用/);
    }
  });

  it('Chat prompt distinguishes the three Markdown truths without hard-coding catalog state', () => {
    const prompt = buildSystemPrompt({ chatMarkdown: true, presentationMarkdown: true });

    expect(prompt).toContain('聊天 Markdown');
    expect(prompt).toContain('Presentation catalog');
    expect(prompt).toContain('业务字段 content type');
    expect(prompt).toContain('不得互相推断');
    expect(prompt).toContain('聊天 Markdown renderer: supported');
    expect(prompt).toContain('Presentation catalog Markdown word: registered');
  });

  it('Chat tool payload stays catalog-agnostic when the live catalog changes', () => {
    const entity = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
    });
    const serialized = JSON.stringify(buildToolProjection(entity));

    expect(serialized).toContain('present');
    expect(serialized).not.toMatch(/markdownWord|catalogVersion|wordSchemas|surfaceTree/);
  });

  it('defines presentation by user-visible success rather than phrase routing', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('成功条件包含客户端可见视图变化');
    expect(prompt).toContain('clientView 尚未证明该结果');
    expect(prompt).toContain('仅在文本中描述实体不能冒充已经呈现');
    expect(prompt).toContain('不得重复 present');
    expect(prompt).toContain('应继续 answer');
    expect(prompt).not.toMatch(/如果用户说[“"].*(看看|列表|详情)/);
  });

  it('Presentation prompt derives markdown-word truth from its injected live catalog', () => {
    const input: BuildRenderPromptInput = {
      intent: '呈现文章正文',
      sitemap: { surfaces: [], flows: [] },
      words: [],
    };
    const withoutMarkdown = buildRenderPrompt(input);
    const withMarkdown = buildRenderPrompt({
      ...input,
      words: [
        {
          name: 'markdown',
          description: '渲染 Markdown 正文',
          bindSchema: { type: 'object' },
        },
      ],
    });

    expect(withoutMarkdown).not.toContain('- markdown:');
    expect(withMarkdown).toContain('- markdown:渲染 Markdown 正文');
  });

  it('business Markdown support appears in Chat evidence only when its field schema declares it', () => {
    const entity = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      actions: [
        {
          name: 'edit',
          title: '编辑',
          method: 'POST',
          href: '/api/exec',
          fields: {
            type: 'object',
            properties: { body: { type: 'string' } },
            additionalProperties: false,
          },
        },
      ],
    });
    const context: DriverContext = {
      goal: { verb: '支持 Markdown 吗' },
      currentRel: 'post:first-post',
      entity,
      observations: [{ rel: 'post:first-post', entity }],
      trail: [],
      successes: [],
    };

    expect(buildUserPrompt(context)).not.toContain('text/markdown');
    const bodySchema = (entity.actions[0]!.fields.properties as Record<string, unknown>)
      .body as Record<string, unknown>;
    bodySchema.contentMediaType = 'text/markdown';
    expect(buildUserPrompt(context)).toContain('"contentMediaType": "text/markdown"');
  });
});
