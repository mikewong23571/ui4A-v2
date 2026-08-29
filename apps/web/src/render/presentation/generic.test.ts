import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GENERIC_INTENT_POLICY,
  planGenericSurface,
  selectGenericFieldCandidates,
  type SirenEntity,
  type SurfaceNode,
} from '@ui4a/engine';

import { PRESENTATION_SURFACE_CATALOG } from '../../engine/presentation/catalog';
import { semanticHintsOf } from '../../engine/presentation/situation';
import { hydratePresentationSurface, planGenericPresentationSurface } from './generic';

function propertyIdentityPaths(node: SurfaceNode): string[] {
  if (node.kind === 'layout') return node.children.flatMap(propertyIdentityPaths);
  if (node.kind === 'slot') return propertyIdentityPaths(node.child);
  if (node.kind === 'repeat') return propertyIdentityPaths(node.item);
  if (node.kind !== 'word' || node.role !== 'identity') return [];
  return Object.values(node.bindings).flatMap((binding) =>
    binding.kind === 'property' ? [binding.path] : [],
  );
}

function stringValues(value: unknown): Set<string> {
  const result = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      result.add(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (typeof candidate === 'object' && candidate !== null) {
      Object.values(candidate as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return result;
}

const post: SirenEntity = {
  class: ['flow-instance'],
  properties: {
    rel: 'post:first-post',
    node: 'published',
    title: '已发布',
    identity: '第一篇',
    status: 'published',
    fields: { title: '第一篇', body: '完整正文', category: 'essay' },
    presentation: {
      fields: [
        { path: 'properties.fields.title', title: '文章标题', role: 'identity' },
        { path: 'properties.fields.body', title: '正文', role: 'primary-content' },
        { path: 'properties.fields.category', title: '分类', role: 'metadata' },
      ],
    },
  },
  actions: [],
  links: [],
};

describe('generic Presentation runtime plan', () => {
  it('hydrates identity/body/status/metadata while keeping facts out of A2UI components', () => {
    const plan = planGenericPresentationSurface('post:first-post', post, 'definition-v1', 'review');
    const components = JSON.stringify(plan.bundle.messages[2]);
    const data = JSON.stringify(plan.bundle.messages[1]);

    expect(plan.bundle.issues).toEqual([]);
    expect(components).not.toContain('完整正文');
    expect(components).not.toContain('第一篇');
    expect(data).toContain('完整正文');
    expect(data).toContain('第一篇');
    expect(data).toContain('published');
    expect(data).toContain('essay');
    expect(data).not.toContain('已发布');
  });

  it('binds a Flow alias request to the canonical entity rel returned by Siren', () => {
    const flow = {
      ...post,
      properties: { ...post.properties, rel: 'article-drafting:main' },
    };
    const plan = planGenericPresentationSurface(
      'flow:article-drafting',
      flow,
      'definition-v1',
      'read',
    );
    expect(plan.bundle.issues).toEqual([]);
    expect(JSON.stringify(plan.surface)).toContain('article-drafting:main');
    expect(JSON.stringify(plan.surface)).not.toContain('$slot');
  });

  it('hydrate 按注视 subject 别名单根依赖实体,绑定不因规范 rel 漂移集体失败(T35 F-03)', () => {
    // 服务端 runtime.plan 以请求 subject(flow:article-drafting)与别名后的
    // 实例实体规划 surface;hydrate 拿到的单根依赖实体 rel 是实例 rel。
    // 绑定 deref 不得因规范 rel 漂移而集体落空。
    const aliasedEntity: SirenEntity = {
      ...post,
      properties: { ...post.properties, rel: 'article-drafting:main' },
    };
    const planned = planGenericSurface(
      'flow:article-drafting',
      aliasedEntity,
      PRESENTATION_SURFACE_CATALOG,
      {
        entityVersion: 'definition-v1',
        intent: 'read',
        semanticHints: semanticHintsOf(aliasedEntity),
        provenanceRef: 'request:test',
      },
    );
    const plan = hydratePresentationSurface('flow:article-drafting', planned, [aliasedEntity]);
    expect(plan.bundle.issues).toEqual([]);
  });

  it('hydrate 按依赖请求 rel 为多根实体补别名键,组合面 flow 入口 region 零 deref-failed(T37)', () => {
    // 组合面(如 workspace:app:publishing)多根 hydrate:依赖按声明源 rel 请求
    // (articles、flow:article-drafting),服务端 flow 别名让第二个根的实际 rel
    // 是 article-drafting:main——已持久化 sidecar 的绑定仍指向声明源。T35 F-03
    // 的单根别名键推广为逐根「请求 rel → 实体」补键;零新事实,同一实体两个键。
    const collection: SirenEntity = {
      class: ['collection', 'articles'],
      properties: { rel: 'articles', title: 'articles', count: 0 },
      actions: [],
      links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
      entities: [],
    };
    const aliasedWizard: SirenEntity = {
      class: ['flow-instance'],
      properties: {
        rel: 'article-drafting:main',
        node: 'drafting',
        identity: '发布向导',
        presentation: {
          fields: [{ path: 'properties.identity', role: 'identity' }],
        },
      },
      actions: [{ name: 'advance', title: '推进', method: 'POST', href: '/api/exec', fields: {} }],
      links: [{ rel: ['self'], href: '/api/entity?rel=article-drafting%3Amain' }],
    };
    // 模拟既有已持久化 sidecar:主体绑定声明源 flow:article-drafting。
    const planned = planGenericSurface(
      'flow:article-drafting',
      aliasedWizard,
      PRESENTATION_SURFACE_CATALOG,
      {
        entityVersion: 'definition-v1',
        intent: '发起 内容发布 的流程',
        semanticHints: semanticHintsOf(aliasedWizard),
        provenanceRef: 'composition-region:article-drafting',
      },
    );
    const plan = hydratePresentationSurface(
      'workspace:app:publishing',
      planned,
      [collection, aliasedWizard],
      ['articles', 'flow:article-drafting'],
    );
    expect(plan.bundle.issues).toEqual([]);
  });

  it('subject 在场但声明字段无值 → 词位诚实空呈现零 deref-failed;subject 缺失仍诊断(T37)', () => {
    // 真实时序(Phase C 实测):捕捉成功 → exec 失效 → face 重规划,sidecar
    // 词条按规划时实体绑定 properties.fields.title(值在场);hydrated 依赖
    // 实体却是回环清空/陈旧缓存后的同 subject 实体(fields 缺该键)。
    // 「新表单未填」是诚实空态——词位按空串渲染,不再整词位 deref-failed;
    // subject 实体缺失(结构级失配)仍必须产 deref-failed 诊断,不静音。
    const withTitle: SirenEntity = {
      class: ['flow-instance', 'todo-capture'],
      properties: {
        rel: 'todo-capture:main',
        flow: 'todo-capture',
        node: 'recorded',
        title: '已记下',
        status: 'recorded',
        fields: { title: 'T37 捕捉闭环验证' },
        presentation: {
          fields: [{ path: 'properties.fields.title', title: 'title', role: 'identity' }],
        },
      },
      actions: [
        { name: 'another', title: '再记一条', method: 'POST', href: '/api/exec', fields: {} },
      ],
      links: [{ rel: ['self'], href: '/api/entity?rel=todo-capture%3Amain' }],
    };
    const planned = planGenericSurface(
      'todo-capture:main',
      withTitle,
      PRESENTATION_SURFACE_CATALOG,
      {
        entityVersion: 'definition-v1',
        intent: '发起 待办 的流程',
        semanticHints: semanticHintsOf(withTitle),
        provenanceRef: 'composition-region:todo-capture',
      },
    );
    // 规划锚定:身份词绑定声明字段(与线上 sidecar 一致)。
    expect(JSON.stringify(planned)).toContain('properties.fields.title');

    // 捕捉回环后:同 subject 实体在,historical title 键已被清空。
    const cleared: SirenEntity = {
      ...withTitle,
      properties: { ...withTitle.properties, node: 'capture', fields: {} },
    };
    const hydrated = hydratePresentationSurface(
      'workspace:app:todo',
      planned,
      [cleared],
      ['flow:todo-capture'],
    );
    expect(hydrated.bundle.issues.filter((issue) => issue.code === 'deref-failed')).toEqual([]);
    // 身份词位以空值诚实渲染(数据模型含空串),而非诊断兜底。
    expect(JSON.stringify(hydrated.bundle.messages[1])).toContain('"value":""');
    expect(JSON.stringify(hydrated.bundle.messages[1])).not.toContain('部分内容暂时无法显示');

    // 结构级失配口径不变:subject 实体缺失仍产 deref-failed 诊断,不静音。
    const unrelated: SirenEntity = {
      class: ['collection', 'articles'],
      properties: { rel: 'articles', count: 0 },
      actions: [],
      links: [],
      entities: [],
    };
    const missing = hydratePresentationSurface(
      'workspace:app:todo',
      planned,
      [unrelated],
      ['articles'],
    );
    expect(missing.bundle.issues.some((issue) => issue.code === 'deref-failed')).toBe(true);
    expect(JSON.stringify(missing.bundle.messages[1])).toContain('部分内容暂时无法显示');
  });

  it('uses a collection-declared human title as identity while retaining the canonical rel', () => {
    const collection: SirenEntity = {
      class: ['collection', 'threads'],
      properties: {
        rel: 'threads',
        title: '我的工作线',
        count: 0,
        presentation: {
          fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
        },
      },
      actions: [],
      links: [{ rel: ['self'], href: '/api/entity?rel=threads' }],
      entities: [],
    };

    const plan = planGenericPresentationSurface('threads', collection, 'definition-v1', 'read');
    expect(plan.bundle.issues).toEqual([]);
    expect(JSON.stringify(plan.surface)).toContain('properties.title');
    expect(propertyIdentityPaths(plan.surface.root)).toEqual(['properties.title']);
    expect(JSON.stringify(plan.bundle.messages[1])).toContain('我的工作线');
    expect(collection.properties.rel).toBe('threads');
  });

  it('keeps compiled components binding-only for random selected intent subsets', () => {
    const roles = ['identity', 'status', 'primary-content', 'metadata', 'relation'] as const;
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: roles.length,
          maxLength: roles.length,
        }),
        fc.constantFrom('read', 'overview', 'review', 'track', 'unknown free-form'),
        (values, intent) => {
          const fields = Object.fromEntries(
            roles.map((role, index) => [`field${index}`, `FACT_${index}_${values[index]}`]),
          );
          const hints = roles.map((role, index) => ({
            path: `properties.fields.field${index}`,
            title: `Field ${index}`,
            role,
          }));
          const entity: SirenEntity = {
            class: ['opaque'],
            properties: {
              rel: 'record:property',
              node: 'active',
              fields,
              presentation: { fields: hints },
            },
            actions: [{ name: 'act', title: 'Act', method: 'POST', href: '/api/exec', fields: {} }],
            links: [{ rel: ['self'], href: '/api/entity?rel=record%3Aproperty' }],
            entities: [],
          };

          const plan = planGenericPresentationSurface(
            'record:property',
            entity,
            'definition-v1',
            intent,
          );
          const components = JSON.stringify(plan.bundle.messages[2]);
          const dataValues = stringValues(plan.bundle.messages[1]);
          for (const value of Object.values(fields)) expect(components).not.toContain(value);

          const selectedPaths = new Set(
            selectGenericFieldCandidates(intent, hints, GENERIC_INTENT_POLICY).map(
              ({ path }) => path,
            ),
          );
          hints.forEach(({ path }, index) => {
            const value = fields[`field${index}`]!;
            expect(dataValues.has(value)).toBe(selectedPaths.has(path));
          });
          expect(JSON.stringify(plan.surface)).not.toMatch(/FACT_/);
          expect(JSON.stringify(plan.surface)).toContain('"kind":"actions"');
          expect(JSON.stringify(plan.surface)).toContain('"kind":"links"');
          expect(JSON.stringify(plan.surface)).toContain('"kind":"entities"');
        },
      ),
      { numRuns: 80 },
    );
  });
  it('集合主体单主体面缺省表格密度:成员词选 member-table(T38;组合显式声明可覆盖)', () => {
    // 集合 = 查询目标:读面参数(offset/filter)只作用于注视集合,集合的
    // 规范形态即表格。组合区域的显式 density 声明优先于本缺省(runtime
    // 侧测试锚定);此处锚定单主体集合面的缺省推导,零 per-app。
    const member: SirenEntity = {
      class: ['flow-instance', 'post-status'],
      properties: { rel: 'post:a', node: 'published', identity: '甲', status: 'published' },
      actions: [
        { name: 'unpublish', title: '下线', method: 'POST', href: '/api/exec', fields: {} },
      ],
      links: [],
    };
    const collection: SirenEntity = {
      class: ['collection', 'articles'],
      properties: { rel: 'articles', title: 'articles', count: 1 },
      actions: [],
      links: [],
      entities: [member],
    };
    const plan = planGenericPresentationSurface('articles', collection, 'v1', 'read');
    expect(plan.bundle.issues).toEqual([]);
    expect(JSON.stringify(plan.surface)).toContain('"member-table"');
    expect(JSON.stringify(plan.surface)).not.toContain('"member-card"');
  });
});
