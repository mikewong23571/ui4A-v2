/**
 * render 意图 → spec 生成器测试(T7 Phase C / spec 架构决定 4,S5)。
 *
 * rule 确定路径(renderSpecFor,纯函数):
 * - 词级匹配:展示/图表词 + 双语名词词表(文章→articles)→ chart/table 词条;
 * - 零字面:bind 只有实体引用(collection+dimension),维度引用真实字段
 *   (字段名必须在 sitemap 流程声明中出现——发明字段 = 事实不可发明);
 * - 凝固路径:同 concern 已凝固 → 直接复用首冻 spec(不重新生成);
 * - 未命中(非展示意图/集合不在 sitemap/维度字段未声明)→ undefined,
 *   交回普通 agent 循环(拒绝即数据,不猜)。
 * LLM 路径接口:buildRenderPrompt(目录+sitemap 上下文)+ parseRenderResponse
 * (fail-safe JSON 解析;零字面把关在 freezeSpec 入口)。
 * T12 Phase A(架构决定 1):hasDisplayIntent(展示意图闸门)+
 * renderSpecGroundingErrors(处境核对:集合 ∈ sitemap 面、维度字段已声明)+
 * generateRenderSpecWithLlm(streamText 生成;无 key 跳过 I1,失败一律 undefined)。
 */
import { describe, expect, it } from 'vitest';

import {
  buildRenderPrompt,
  generateRenderSpecWithLlm,
  hasDisplayIntent,
  parseRenderResponse,
  renderSpecFor,
  renderSpecGroundingErrors,
  type BuildRenderPromptInput,
  type FrozenSpecEntry,
  type RenderSitemapContext,
} from './render';
import { createScriptedTransport, jsonResponse } from './testkit';

/** 最小 sitemap 上下文(种子域形状:articles/comments 集合面 + drafting 流程声明 category 字段)。 */
const SITEMAP: RenderSitemapContext = {
  surfaces: [
    { rel: 'flow:article-drafting', title: '文章发布向导' },
    { rel: 'articles', title: 'articles', collection: true },
    { rel: 'comments', title: 'comments', collection: true },
  ],
  flows: [
    {
      name: 'article-drafting',
      title: '文章发布向导',
      nodes: [
        { name: 'classification', fields: [{ name: 'category' }, { name: 'tags' }] },
        { name: 'basic-info', fields: [{ name: 'title' }] },
      ],
    },
  ],
};

/** 无 category 字段声明的 sitemap(维度引用真实字段的反例)。 */
const SITEMAP_WITHOUT_CATEGORY: RenderSitemapContext = {
  surfaces: SITEMAP.surfaces,
  flows: [
    { name: 'article-drafting', title: '文章发布向导', nodes: [{ name: 'basic-info', fields: [{ name: 'title' }] }] },
  ],
};

describe('renderSpecFor:rule 确定路径(词级匹配 → 零字面 spec)', () => {
  it('"按分类展示文章" → chart 词条:articles 按 category 维度聚合', () => {
    expect(renderSpecFor('按分类展示文章', SITEMAP, [])).toEqual({
      concern: 'articles-by-category',
      component: 'chart',
      bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
    });
  });

  it('"图表 文章 分类"(词序无关)→ 同一 chart spec(同 concern 即同布局)', () => {
    expect(renderSpecFor('图表 文章 分类', SITEMAP, [])).toEqual(
      renderSpecFor('按分类展示文章', SITEMAP, []),
    );
  });

  it('英文词元同样命中:show articles by category', () => {
    expect(renderSpecFor('show articles by category', SITEMAP, [])).toEqual({
      concern: 'articles-by-category',
      component: 'chart',
      bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
    });
  });

  it('"展示文章列表"(无维度词)→ table 词条', () => {
    expect(renderSpecFor('展示文章列表', SITEMAP, [])).toEqual({
      concern: 'articles-list',
      component: 'table',
      bind: { rows: { collection: 'articles' } },
    });
  });

  it('评论集合同样可渲染(show comments → table)', () => {
    expect(renderSpecFor('列出评论', SITEMAP, [])).toEqual({
      concern: 'comments-list',
      component: 'table',
      bind: { rows: { collection: 'comments' } },
    });
  });

  it('凝固路径:同 concern 已凝固 → 直接复用首冻 spec(不重新生成)', () => {
    const frozen: FrozenSpecEntry[] = [
      {
        concern: 'articles-by-category',
        component: 'chart',
        bind: { series: { collection: 'articles', dimension: 'articles.fields.status' } },
      },
    ];
    const spec = renderSpecFor('按分类展示文章', SITEMAP, frozen);
    expect(spec).toEqual(frozen[0]);
  });

  it('非展示意图("发布一篇文章")→ undefined(交回普通循环)', () => {
    expect(renderSpecFor('发布一篇文章', SITEMAP, [])).toBeUndefined();
  });

  it('展示意图但集合不在 sitemap("展示飞船列表")→ undefined(不猜集合)', () => {
    expect(renderSpecFor('展示飞船列表', SITEMAP, [])).toBeUndefined();
  });

  it('维度词命中但字段未在 sitemap 流程声明 → undefined(不发明字段)', () => {
    expect(renderSpecFor('按分类展示文章', SITEMAP_WITHOUT_CATEGORY, [])).toBeUndefined();
  });

  it('生成的 spec 递归零字面(bind 只有引用节点;白名单口径同 validator)', () => {
    const spec = renderSpecFor('按分类展示文章', SITEMAP, []);
    expect(spec).toBeDefined();
    // 引用节点(ref/field/collection[+dimension])的字符串值是"指向哪"的
    // 声明(validator 白名单键);结构容器的值必须仍是引用节点/容器。
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === 'object' && node !== null) {
        const record = node as Record<string, unknown>;
        if ('ref' in record || 'field' in record || 'collection' in record) return;
        for (const value of Object.values(record)) walk(value);
        return;
      }
      throw new Error(`裸字面载荷:${String(node)}`);
    };
    walk(spec!.bind);
  });
});

describe('buildRenderPrompt:LLM 路径上下文组装', () => {
  const words = [
    {
      name: 'chart',
      description: '聚合图表:series 绑定集合引用 + dimension 维度声明',
      bindSchema: { properties: { series: { type: 'object' } } },
    },
    {
      name: 'table',
      description: '表格:rows 绑定集合引用',
      bindSchema: { properties: { rows: { type: 'object' } } },
    },
  ];

  it('prompt 含目标、词汇表词名与集合面(处境披露)', () => {
    const prompt = buildRenderPrompt({ intent: '按分类展示文章', sitemap: SITEMAP, words });
    expect(prompt).toContain('按分类展示文章');
    expect(prompt).toContain('chart');
    expect(prompt).toContain('table');
    expect(prompt).toContain('articles');
    expect(prompt).toContain('concern');
  });

  it('prompt 声明零字面铁律(bind 只允许引用节点)', () => {
    const prompt = buildRenderPrompt({ intent: '按分类展示文章', sitemap: SITEMAP, words });
    expect(prompt).toContain('字面');
    expect(prompt).toContain('collection');
  });
});

describe('parseRenderResponse:fail-safe 解析(mock 口径)', () => {
  it('合法 JSON → spec', () => {
    const text = JSON.stringify({
      concern: 'articles-by-category',
      component: 'chart',
      bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
    });
    expect(parseRenderResponse(text)).toEqual({
      concern: 'articles-by-category',
      component: 'chart',
      bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
    });
  });

  it('包裹在散文中的 JSON 代码块 → 提取', () => {
    const text = '好的,渲染说明如下:\n```json\n{"concern":"articles-list","component":"table","bind":{"rows":{"collection":"articles"}}}\n```\n请查收';
    expect(parseRenderResponse(text)).toEqual({
      concern: 'articles-list',
      component: 'table',
      bind: { rows: { collection: 'articles' } },
    });
  });

  it('缺键/错型/非对象 bind → undefined(fail-safe,零异常)', () => {
    expect(parseRenderResponse('{"component":"chart","bind":{}}')).toBeUndefined();
    expect(parseRenderResponse('{"concern":"","component":"chart","bind":{}}')).toBeUndefined();
    expect(parseRenderResponse('{"concern":"c","component":"chart","bind":[]}')).toBeUndefined();
    expect(parseRenderResponse('{"concern":"c","component":"chart"}')).toBeUndefined();
  });

  it('非 JSON 文本 → undefined', () => {
    expect(parseRenderResponse('抱歉,我无法生成渲染说明。')).toBeUndefined();
    expect(parseRenderResponse('')).toBeUndefined();
  });
});

// ---- T12 Phase A:LLM fallthrough(架构决定 1)--------------------------------

/** OpenAI 兼容 SSE 流(chat.completion.chunk 序列 + [DONE];streamText 的传输形态)。 */
function sseResponse(chunks: unknown[]): Response {
  const body = `${[...chunks.map((entry) => `data: ${JSON.stringify(entry)}`), 'data: [DONE]'].join('\n\n')}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 单个 chat.completion.chunk(delta + finish_reason;信封字段满足 SDK 校验)。 */
function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-render',
    object: 'chat.completion.chunk',
    created: 1756000000,
    model: 'glm-test',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/** 纯文本回复的 SSE 响应(render 生成只要文本,无工具调用)。 */
function openaiTextResponse(text: string): Response {
  return sseResponse([chunk({ role: 'assistant', content: text }), chunk({}, 'stop')]);
}

describe('hasDisplayIntent:展示意图闸门(T12;renderSpecFor 入口闸与 LLM fallthrough 前置闸共用)', () => {
  it('展示/图表词命中 → true(中英双语)', () => {
    expect(hasDisplayIntent('展示飞船列表')).toBe(true);
    expect(hasDisplayIntent('把数据可视化一下')).toBe(true);
    expect(hasDisplayIntent('show articles')).toBe(true);
  });

  it('非展示意图 → false(发布/保存不进 render 路径)', () => {
    expect(hasDisplayIntent('发布一篇文章')).toBe(false);
    expect(hasDisplayIntent('save the draft')).toBe(false);
  });
});

describe('renderSpecGroundingErrors:LLM 产 spec 的处境核对(T12;事实不可发明)', () => {
  it('collection ∈ sitemap 集合面 + dimension 字段已声明 → 零违规', () => {
    expect(
      renderSpecGroundingErrors(
        {
          concern: 'articles-by-category',
          component: 'chart',
          bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
        },
        SITEMAP,
      ),
    ).toEqual([]);
  });

  it('collection 不在 sitemap 集合面 → 违规(不发明集合)', () => {
    const errors = renderSpecGroundingErrors(
      { concern: 'ships-board', component: 'kanban', bind: { columns: { collection: 'spaceships' } } },
      SITEMAP,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('spaceships');
  });

  it('dimension 字段未在 sitemap 流程节点声明 → 违规(假字段拒)', () => {
    const errors = renderSpecGroundingErrors(
      {
        concern: 'articles-by-ghost',
        component: 'chart',
        bind: { series: { collection: 'articles', dimension: 'articles.fields.ghost' } },
      },
      SITEMAP,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ghost');
  });

  it('嵌套结构(数组/结构字典)同样走查', () => {
    const errors = renderSpecGroundingErrors(
      {
        concern: 'mixed',
        component: 'table',
        bind: { rows: { collection: 'articles' }, extra: [{ collection: 'ghosts' }] },
      },
      SITEMAP,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ghosts');
  });

  it('ref/field 实例级引用不在此核对(真实性由解引用器渲染时把关)→ 零违规', () => {
    expect(
      renderSpecGroundingErrors(
        {
          concern: 'welcome-stat',
          component: 'stat',
          bind: { value: { field: 'post:post-welcome.fields.title' } },
        },
        SITEMAP,
      ),
    ).toEqual([]);
  });
});

describe('generateRenderSpecWithLlm:LLM 生成路径(T12;脚本化传输,零网络)', () => {
  const input: BuildRenderPromptInput = {
    intent: '展示飞船列表',
    sitemap: SITEMAP,
    words: [
      {
        name: 'kanban',
        description: '看板视图:columns 绑定集合引用',
        bindSchema: { properties: { columns: { type: 'object' } } },
      },
    ],
  };

  it('合法 JSON 文本 → spec;prompt 携带意图 + sitemap 集合面 + 词汇表(处境披露)', async () => {
    const transport = createScriptedTransport(() =>
      openaiTextResponse(
        JSON.stringify({
          concern: 'articles-board',
          component: 'kanban',
          bind: { columns: { collection: 'articles' } },
        }),
      ),
    );

    const spec = await generateRenderSpecWithLlm(input, {
      apiKey: 'test-key',
      fetchImpl: transport.fetch,
    });

    expect(spec).toEqual({
      concern: 'articles-board',
      component: 'kanban',
      bind: { columns: { collection: 'articles' } },
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.url).toContain('/chat/completions');
    const body = JSON.stringify(transport.calls[0]!.body);
    expect(body).toContain('展示飞船列表');
    expect(body).toContain('articles');
    expect(body).toContain('kanban');
  });

  it('散文包裹的 JSON 代码块 → 提取(parseRenderResponse fail-safe 提取口径)', async () => {
    const transport = createScriptedTransport(() =>
      openaiTextResponse(
        '渲染说明:\n```json\n{"concern":"articles-list","component":"table","bind":{"rows":{"collection":"articles"}}}\n```',
      ),
    );

    const spec = await generateRenderSpecWithLlm(input, {
      apiKey: 'test-key',
      fetchImpl: transport.fetch,
    });

    expect(spec).toEqual({
      concern: 'articles-list',
      component: 'table',
      bind: { rows: { collection: 'articles' } },
    });
  });

  it('非法 JSON 文本 → undefined(fail-safe,调用方交回普通循环)', async () => {
    const transport = createScriptedTransport(() => openaiTextResponse('抱歉,我无法生成渲染说明。'));

    await expect(
      generateRenderSpecWithLlm(input, { apiKey: 'test-key', fetchImpl: transport.fetch }),
    ).resolves.toBeUndefined();
  });

  it('端点 401 → undefined(端点失败同口径:不抛异常,交回普通循环)', async () => {
    const transport = createScriptedTransport(() =>
      jsonResponse({ error: { code: '1002', message: '令牌无效或已过期' } }, 401),
    );

    await expect(
      generateRenderSpecWithLlm(input, { apiKey: 'test-key', fetchImpl: transport.fetch }),
    ).resolves.toBeUndefined();
  });

  it('无 key → undefined 且零传输调用(I1:跳过 LLM 路径,rule 路径完整)', async () => {
    const envKey = process.env.GLM_API_KEY;
    delete process.env.GLM_API_KEY;
    try {
      const transport = createScriptedTransport(() => {
        throw new Error('不应发起 LLM 调用');
      });

      await expect(
        generateRenderSpecWithLlm(input, { fetchImpl: transport.fetch }),
      ).resolves.toBeUndefined();
      expect(transport.calls).toHaveLength(0);
    } finally {
      if (envKey === undefined) delete process.env.GLM_API_KEY;
      else process.env.GLM_API_KEY = envKey;
    }
  });
});
