/**
 * 画布 surface 规划流测试(T7 Phase B / spec 架构决定 2/3):
 * spec(凝固或新生成)→ 引用收集 → 拉实体进缓存 → deref → A2UI 四消息
 * (createSurface/updateDataModel/updateComponents)。
 *
 * - updateDataModel 是渲染器私有操作(数据模型从 /api/entity 拉取,
 *   agent 不发数值——spec 架构决定 3a);
 * - 组件按数据模型路径绑定(updateComponents 的 props 全为 {path} 引用);
 * - 非法 spec(零字面不过/词条形状不符)响亮拒绝,不产半截消息。
 */
import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import type { RenderSpec } from '../spec';
import { articlesCollection } from '../words/fixtures';

import { collectRefs, planSurface, surfaceIdOf } from './surface-flow';

const ARTICLES = articlesCollection();

async function fetchArticles(rel: string): Promise<SirenEntity | null> {
  return rel === 'articles' ? ARTICLES : null;
}

describe('引用收集', () => {
  it('bind 树的全部引用 rel 一并收集(去重,保持首见序)', () => {
    const bind: RenderSpec['bind'] = {
      rows: { collection: 'articles' },
      caption: { field: 'articles.rel' },
      extra: [{ ref: 'entity:post:post-welcome' }, { collection: 'comments' }],
    };
    expect(collectRefs(bind)).toEqual([
      'articles',
      'post:post-welcome',
      'comments',
    ]);
  });
});

describe('surface 规划', () => {
  it('合法 spec → createSurface(catalogId 协商)+ updateDataModel(props)+ updateComponents(路径绑定)', async () => {
    const plan = await planSurface(
      { concern: 'articles-table', component: 'table', bind: { rows: { collection: 'articles' } } },
      fetchArticles,
    );

    expect(plan.surfaceId).toBe('articles-table');
    expect(plan.messages).toHaveLength(3);
    const [create, data, components] = plan.messages as unknown as [
      Record<string, { surfaceId: string; catalogId?: string; path?: string; value?: unknown; components?: unknown[] }>,
      Record<string, { surfaceId: string; catalogId?: string; path?: string; value?: unknown; components?: unknown[] }>,
      Record<string, { surfaceId: string; catalogId?: string; path?: string; value?: unknown; components?: unknown[] }>,
    ];
    expect(create.createSurface).toMatchObject({
      surfaceId: 'articles-table',
      catalogId: 'https://ui4a.dev/render/v1/catalog.json',
    });
    // 渲染器私有数据模型:deref 输出写入 path,值即解引用结果
    expect(data.updateDataModel?.path).toBe('/concerns/articles-table/props');
    expect(data.updateDataModel?.value).toEqual({ rows: ARTICLES.entities });
    // 组件树:词名 + props 全为 {path} 绑定(数据与组件分离;根组件 id='root')
    const component = components.updateComponents?.components?.[0] as Record<string, unknown>;
    expect(component.component).toBe('table');
    expect(component.id).toBe('root');
    expect(component.rows).toEqual({ path: '/concerns/articles-table/props/rows' });
  });

  it('被引用实体拉取失败 → 响亮抛错(缺数据不造数据)', async () => {
    await expect(
      planSurface(
        { concern: 'x', component: 'table', bind: { rows: { collection: 'ghost' } } },
        fetchArticles,
      ),
    ).rejects.toThrow(/ghost/);
  });

  it('零字面违规 spec → 拒绝(不产消息)', async () => {
    await expect(
      planSurface(
        { concern: 'x', component: 'table', bind: { rows: 42 } as unknown as RenderSpec['bind'] },
        fetchArticles,
      ),
    ).rejects.toThrow(/校验失败/);
  });

  it('词条形状不符(rows 用 field 节点)→ 拒绝', async () => {
    await expect(
      planSurface(
        { concern: 'x', component: 'table', bind: { rows: { field: 'articles.rel' } } },
        fetchArticles,
      ),
    ).rejects.toThrow(/bindSchema|词条/);
  });

  it('surfaceId 消毒:concern 里的非标识字符折成连字符(确定性)', () => {
    expect(surfaceIdOf('demo:articles/table v1')).toBe('demo-articles-table-v1');
    expect(surfaceIdOf('demo:articles/table v1')).toBe(surfaceIdOf('demo:articles/table v1'));
  });
});
