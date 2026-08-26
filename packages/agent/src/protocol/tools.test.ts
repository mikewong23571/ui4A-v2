/**
 * 工具投影生成器形状测试(T2 Phase E / Task E1,arch-brief §6):
 * - 固定动词包含薄 present 请求，不把 Surface 或 catalog 暴露给 Chat;
 * - 动态动作工具:当前实体 actions[] 逐个生成(字段 schema 内联参数);
 * - guard-results blocked 的动作 description 写明 "blocked: <谓词名> 失败";
 * - navigate 的 rel 从 links(+子实体)生成 enum。
 * 纯形状测试:不触网、不依赖 ai sdk(描述符是框架无关的 JSON Schema 载体)。
 */
import type { SirenAction, SirenEntity } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { buildToolProjection } from './tools';
import { sliceSitemapDisclosure } from '../contract/disclosure';
import { collectionEntity, instanceEntity } from '../testkit/testkit';

function textFieldsSchema(required: string[]): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { title: { type: 'string', title: '标题' } },
    required,
    additionalProperties: false,
  };
}

const nextAction: SirenAction = {
  name: 'next',
  title: '下一步',
  method: 'POST',
  href: '/api/exec',
  fields: textFieldsSchema(['title']),
};

const wizardEntity = instanceEntity({
  rel: 'article-drafting:main',
  flow: 'article-drafting',
  node: 'basic-info',
  actions: [nextAction],
  collection: 'articles',
});

describe('固定协议动词', () => {
  it('navigate/answer/exec/clarify/present/done/fail 全部在投影中,名称唯一', () => {
    const tools = buildToolProjection(wizardEntity);
    const names = tools.map((tool) => tool.name);
    for (const verb of ['navigate', 'answer', 'exec', 'clarify', 'present', 'done', 'fail']) {
      expect(names, `动词 ${verb} 应在工具列表`).toContain(verb);
    }
    expect(names).not.toContain('render');
    expect(new Set(names).size).toBe(names.length);
  });

  it('answer 是协议级只读出口,要求 content 与 rel + JSON Pointer 来源', () => {
    const answer = buildToolProjection(wizardEntity).find((tool) => tool.name === 'answer')!;
    expect(answer.description).toContain('临时对话回答');
    expect(answer.description).toContain('不产生业务副作用');

    const parameters = answer.parameters as {
      required: string[];
      properties: {
        sources: { items: { required: string[]; properties: Record<string, unknown> } };
      };
    };
    expect(parameters.required).toEqual(['content', 'sources']);
    expect(parameters.properties.sources.items.required).toEqual(['rel', 'pointer']);
    expect(parameters.properties.sources.items.properties).toHaveProperty('rel');
    expect(parameters.properties.sources.items.properties).toHaveProperty('pointer');
  });

  it('navigate 的 rel 参数从 links 生成 enum(排除 self)', () => {
    const tools = buildToolProjection(wizardEntity);
    const navigate = tools.find((tool) => tool.name === 'navigate')!;
    const parameters = navigate.parameters as {
      properties: { rel: { enum?: string[] } };
      required: string[];
    };
    expect(parameters.properties.rel.enum).toEqual(['articles']);
    expect(parameters.required).toEqual(['rel']);
  });

  it('合并当前授权 sitemap surfaces，使任意合法起点仍可动态发现其他 surface', () => {
    const isolated = instanceEntity({
      rel: 'flow:article-drafting',
      flow: 'article-drafting',
      node: 'basic-info',
      actions: [nextAction],
    });
    const navigate = buildToolProjection(isolated, [
      'flow:article-drafting',
      'articles',
      'flow:post-status',
    ]).find((tool) => tool.name === 'navigate')!;
    const parameters = navigate.parameters as { properties: { rel: { enum?: string[] } } };

    expect(parameters.properties.rel.enum).toEqual(['articles', 'flow:post-status']);
  });

  it('合并实体 links、当前 scope surface 与 foreign navigation-only entry', () => {
    const disclosure = sliceSitemapDisclosure(
      {
        version: 'v-scope',
        surfaces: [
          { rel: 'alpha-home', title: 'Alpha', app: 'alpha' },
          { rel: 'beta-home', title: 'Beta', app: 'beta' },
        ],
        applications: [
          { name: 'alpha', intent: 'alpha', flows: [] },
          { name: 'beta', intent: 'beta', flows: [] },
        ],
      },
      { scope: 'alpha', currentRel: 'alpha-home' },
    );
    const navigate = buildToolProjection(
      wizardEntity,
      disclosure.surfaces.map(({ rel }) => rel),
    ).find((tool) => tool.name === 'navigate')!;
    const parameters = navigate.parameters as { properties: { rel: { enum?: string[] } } };

    expect(parameters.properties.rel.enum).toEqual(['articles', 'alpha-home', 'beta-home']);
    expect(disclosure.surfaces[1]).toEqual({ rel: 'beta-home', title: 'Beta' });
  });

  it('done 要求 summary;exec 枚举当前实体动作名并要求授权证据', () => {
    const tools = buildToolProjection(wizardEntity);
    const done = tools.find((tool) => tool.name === 'done')!;
    expect((done.parameters as { required: string[] }).required).toEqual(['summary']);

    const exec = tools.find((tool) => tool.name === 'exec')!;
    const parameters = exec.parameters as {
      properties: { action: { enum?: string[] }; params: unknown };
      required: string[];
    };
    expect(parameters.properties.action.enum).toEqual(['next']);
    expect(parameters.properties.params).toBeDefined();
    expect(parameters.required).toEqual(['action', 'authorization']);
    expect(parameters).toHaveProperty('properties.authorization');

    const execPlan = tools.find((tool) => tool.name === 'exec_plan')!;
    expect((execPlan.parameters as { required: string[] }).required).toEqual([
      'steps',
      'authorization',
    ]);
  });

  it('fail 要求 reason,并允许字符串 evidence', () => {
    const fail = buildToolProjection(wizardEntity).find((tool) => tool.name === 'fail')!;
    const parameters = fail.parameters as {
      required: string[];
      properties: { evidence: { items: { type: string } } };
    };
    expect(parameters.required).toEqual(['reason']);
    expect(parameters.properties.evidence.items.type).toBe('string');
  });

  it('clarify 是协议级澄清出口，携带问题与原目标延续', () => {
    const tools = buildToolProjection(wizardEntity);
    const clarify = tools.find((candidate) => candidate.name === 'clarify')!;
    expect(clarify.description).toContain('协议级');
    expect(clarify.description).toContain('不是 application capability');
    expect((clarify.parameters as { required: string[] }).required).toEqual([
      'question',
      'continuation',
    ]);
  });

  it('present 只让模型提供薄呈现意图，运行态字段和 Surface 载荷不进入 Chat 工具', () => {
    const present = buildToolProjection(wizardEntity).find(
      (candidate) => candidate.name === 'present',
    )!;
    expect(present.description).toContain('Presentation Plane');
    expect(present.description).toContain('实时 catalog');

    const parameters = present.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(parameters.required).toEqual(['subject', 'intent', 'delivery']);
    expect(Object.keys(parameters.properties).sort()).toEqual([
      'constraints',
      'delivery',
      'intent',
      'subject',
    ]);
    expect(JSON.stringify(parameters)).not.toMatch(
      /requestId|principal|sourceMessageIds|surface|component|bind|dependenc|catalog/i,
    );
  });
});

describe('动态动作工具', () => {
  it('当前实体 actions[] 逐个生成工具(action_ 前缀),保留字段并要求授权证据', () => {
    const tools = buildToolProjection(wizardEntity);
    const actionTool = tools.find((tool) => tool.name === 'action_next')!;
    expect(actionTool).toBeDefined();
    expect(actionTool.description).toContain('下一步');
    expect(actionTool.description).toContain('next');
    expect(actionTool.parameters).toMatchObject({
      properties: {
        title: { type: 'string', title: '标题' },
        authorization: { type: 'object' },
      },
      required: ['title', 'authorization'],
      additionalProperties: false,
    });
  });

  it('guard-results blocked 的动作 description 写明 "blocked: <谓词名> 失败"', () => {
    const blockedEntity = instanceEntity({
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'published',
      actions: [
        {
          name: 'unpublish',
          title: '下线',
          method: 'POST',
          href: '/api/exec',
          fields: textFieldsSchema([]),
        },
      ],
      guardResults: [
        { action: 'unpublish', blocked: true, reason: 'guard 不满足: is-published=false' },
      ],
    });
    const tools = buildToolProjection(blockedEntity);
    const unpublish = tools.find((tool) => tool.name === 'action_unpublish')!;
    expect(unpublish.description).toContain('blocked: is-published 失败');
  });

  it('guard 通过的动作 description 不携带 blocked 标记', () => {
    const tools = buildToolProjection(wizardEntity);
    const actionTool = tools.find((tool) => tool.name === 'action_next')!;
    expect(actionTool.description).not.toContain('blocked');
  });
});

describe('集合实体投影', () => {
  it('navigate enum 覆盖子实体 rel 与 flow 入口链接', () => {
    const articles = collectionEntity({
      rel: 'articles',
      members: [
        { rel: 'post:post-welcome', flow: 'post-status', node: 'published' },
        { rel: 'post:first-post', flow: 'post-status', node: 'published' },
      ],
    });
    const withFlowLink: SirenEntity = {
      ...articles,
      links: [
        ...articles.links,
        { rel: ['flow'], href: `/api/entity?rel=${encodeURIComponent('flow:article-drafting')}` },
      ],
    };
    const tools = buildToolProjection(withFlowLink);
    const navigate = tools.find((tool) => tool.name === 'navigate')!;
    const parameters = navigate.parameters as { properties: { rel: { enum?: string[] } } };
    // links 在前(flow 入口)、子实体在后——与 navigableRels 的候选顺序一致。
    expect(parameters.properties.rel.enum).toEqual([
      'flow:article-drafting',
      'post:post-welcome',
      'post:first-post',
    ]);
  });
});
