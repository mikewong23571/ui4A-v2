/** Independent Presentation-Agent prompt, parser, grounding, and transport tests. */
import { describe, expect, it } from 'vitest';

import {
  buildRenderPrompt,
  generateRenderSpecWithLlm,
  parseRenderResponse,
  renderSpecGroundingErrors,
  type BuildRenderPromptInput,
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
    const text =
      '好的,渲染说明如下:\n```json\n{"concern":"articles-list","component":"table","bind":{"rows":{"collection":"articles"}}}\n```\n请查收';
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
      {
        concern: 'ships-board',
        component: 'kanban',
        bind: { columns: { collection: 'spaceships' } },
      },
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

  it('caption 只接受可证明存在的集合标量引用,成员级 dangling 字段拒绝', () => {
    expect(
      renderSpecGroundingErrors(
        {
          concern: 'articles-list',
          component: 'table',
          bind: { rows: { collection: 'articles' }, caption: { field: 'articles.rel' } },
        },
        SITEMAP,
      ),
    ).toEqual([]);

    const errors = renderSpecGroundingErrors(
      {
        concern: 'articles-list',
        component: 'table',
        bind: {
          rows: { collection: 'articles' },
          caption: { field: 'articles.fields.title' },
        },
      },
      SITEMAP,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('caption');
    expect(errors[0]).toContain('articles.fields.title');
  });
});

describe('generateRenderSpecWithLlm:LLM 生成路径(T12;脚本化传输,零网络)', () => {
  const config = {
    apiKey: 'test-key',
    baseURL: 'https://provider.test/v1',
    model: 'test-model',
  } as const;
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
      ...config,
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
      ...config,
      fetchImpl: transport.fetch,
    });

    expect(spec).toEqual({
      concern: 'articles-list',
      component: 'table',
      bind: { rows: { collection: 'articles' } },
    });
  });

  it('非法 JSON 文本 → undefined(fail-safe,调用方交回普通循环)', async () => {
    const transport = createScriptedTransport(() =>
      openaiTextResponse('抱歉,我无法生成渲染说明。'),
    );

    await expect(
      generateRenderSpecWithLlm(input, { ...config, fetchImpl: transport.fetch }),
    ).resolves.toBeUndefined();
  });

  it('reasoning_content 增量经 onReasoningDelta 逐片转发;解析结果不变', async () => {
    // D22 同因:SDK 剥离 reasoning_content,增量只能从 raw 部件解析
    // (includeRawChunks;与 llm-driver 共用 raw-reasoning 解析器)。
    const specJson = JSON.stringify({
      concern: 'articles-board',
      component: 'kanban',
      bind: { columns: { collection: 'articles' } },
    });
    const transport = createScriptedTransport(() =>
      sseResponse([
        chunk({ reasoning_content: '先看词汇表' }),
        chunk({ reasoning_content: ',再定词条。' }),
        chunk({ role: 'assistant', content: specJson }),
        chunk({}, 'stop'),
      ]),
    );
    const deltas: string[] = [];

    const spec = await generateRenderSpecWithLlm(
      input,
      { ...config, fetchImpl: transport.fetch },
      { onReasoningDelta: (piece) => deltas.push(piece) },
    );

    expect(spec).toEqual({
      concern: 'articles-board',
      component: 'kanban',
      bind: { columns: { collection: 'articles' } },
    });
    expect(deltas).toEqual(['先看词汇表', ',再定词条。']);
  });

  it('onReasoningDelta 抛错 → 结果不受影响(fail-safe 口径,观测者不得污染生成路径)', async () => {
    const transport = createScriptedTransport(() =>
      sseResponse([
        chunk({ reasoning_content: '自述' }),
        chunk({
          role: 'assistant',
          content: JSON.stringify({
            concern: 'articles-list',
            component: 'table',
            bind: { rows: { collection: 'articles' } },
          }),
        }),
        chunk({}, 'stop'),
      ]),
    );

    const spec = await generateRenderSpecWithLlm(
      input,
      { ...config, fetchImpl: transport.fetch },
      {
        onReasoningDelta: () => {
          throw new Error('观测者爆炸');
        },
      },
    );

    expect(spec).toEqual({
      concern: 'articles-list',
      component: 'table',
      bind: { rows: { collection: 'articles' } },
    });
  });

  it('端点 401 → undefined(端点失败同口径:不抛异常,交回普通循环)', async () => {
    const transport = createScriptedTransport(() =>
      jsonResponse({ error: { code: '1002', message: '令牌无效或已过期' } }, 401),
    );

    await expect(
      generateRenderSpecWithLlm(input, { ...config, fetchImpl: transport.fetch }),
    ).resolves.toBeUndefined();
  });

  it('配置不完整 → undefined 且零传输调用', async () => {
    const env = {
      key: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL,
    };
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    try {
      const transport = createScriptedTransport(() => {
        throw new Error('不应发起 LLM 调用');
      });

      await expect(
        generateRenderSpecWithLlm(input, { fetchImpl: transport.fetch }),
      ).resolves.toBeUndefined();
      expect(transport.calls).toHaveLength(0);
    } finally {
      for (const [name, value] of Object.entries({
        LLM_API_KEY: env.key,
        LLM_BASE_URL: env.baseURL,
        LLM_MODEL: env.model,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
