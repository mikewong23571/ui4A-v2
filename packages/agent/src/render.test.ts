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
 */
import { describe, expect, it } from 'vitest';

import {
  buildRenderPrompt,
  parseRenderResponse,
  renderSpecFor,
  type FrozenSpecEntry,
  type RenderSitemapContext,
} from './render';

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
