/**
 * 画布动作处理的页面级缓存接线测试(T12 Phase B Task 3 / spec 架构决定 3、验收 5)。
 *
 * createCanvasActionHandler = action 拦截门与页面级实体缓存之间的接线:
 * - executed → 精确失效(当前 rel + 实体回链的真实所属 collection)+ 整面
 *   reload(D18 兜底保留):重载后受影响 rel 重取,无关 rel 命中页面缓存;
 * - rejected(白名单外)/ refused(裁决层拒)→ 零失效零 reload(诚实失败口径不变)。
 *
 * 缓存语义用真实 PageEntityCache 对拍(计数 fetcher),不 mock 失效口径本身。
 */
import { describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { createActionGate, type CanvasClientAction, type GateExecFn } from '@/render/canvas/action-gate';
import { collectionBacklinkOf, PageEntityCache } from '@/render/entity-cache';

import { createCanvasActionHandler } from './canvas-body';
import type { EntityCacheHandle } from './entity-cache-provider';

/** 已声明 publish 动作的实例(links 携带 collection 回链,引擎成员反查口径)。 */
function instance(rel: string, collection: string): SirenEntity {
  return {
    class: ['flow-instance', 'post-status'],
    properties: { rel, node: 'draft', fields: {} },
    actions: [
      {
        name: 'publish',
        title: '发布',
        method: 'POST',
        href: '/api/exec',
        fields: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ],
    links: [
      { rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` },
      { rel: ['collection'], href: `/api/entity?rel=${collection}` },
    ],
  };
}

function collection(rel: string): SirenEntity {
  return {
    class: ['collection', rel],
    properties: { rel, count: 0 },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${rel}` }],
    entities: [],
  };
}

/** 计数 fetcher:rel → 实体字典应答(模拟 /api/entity)。 */
function countingFetcher(entities: Record<string, SirenEntity>) {
  const fetcher = vi.fn(async (rel: string): Promise<SirenEntity | null> => entities[rel] ?? null);
  return { fetcher, callsOf: (rel: string) => fetcher.mock.calls.filter(([arg]) => arg === rel) };
}

/** 真实缓存的句柄(与 provider 的 createHandle 同口径;version 戳固定 v1)。 */
function realHandle(fetcher: (rel: string) => Promise<SirenEntity | null>): EntityCacheHandle {
  const cache = new PageEntityCache(fetcher);
  return {
    get: (rel) => cache.get(rel, 'v1'),
    invalidateAfterExec: (rel, entity) => {
      const backlink = entity !== undefined ? collectionBacklinkOf(entity) : undefined;
      cache.invalidateAfterExec(rel, backlink !== undefined ? { collection: backlink } : undefined);
    },
  };
}

function action(name: string, rel: string): CanvasClientAction {
  return {
    name,
    surfaceId: 's1',
    sourceComponentId: 'root',
    timestamp: '2026-08-22T00:00:00.000Z',
    context: { rel },
  };
}

describe('createCanvasActionHandler:exec 后精确失效 + 整面 reload', () => {
  it('executed → 当前 rel + 真实所属 collection 失效重取,无关 rel 命中缓存;reload 触发一次', async () => {
    const post = instance('post:p1', 'articles');
    const { fetcher, callsOf } = countingFetcher({
      articles: collection('articles'),
      comments: collection('comments'),
    });
    const handle = realHandle(fetcher);

    // 同页两 surface 共享缓存:同 rel 二次规划零重复 fetch(先钉住读路径)。
    expect(await handle.get('articles')).not.toBeNull();
    expect(await handle.get('articles')).not.toBeNull();
    expect(await handle.get('comments')).not.toBeNull();
    expect(callsOf('articles')).toHaveLength(1);

    const execFn = vi.fn<GateExecFn>().mockResolvedValue({ ok: true, entity: post });
    const gate = createActionGate(execFn);
    gate.register(post);
    const notify = vi.fn();
    const reload = vi.fn();
    const handler = createCanvasActionHandler({ gate, cache: handle, notify, reload });

    await handler(action('publish', 'post:p1'));

    expect(execFn).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('动作已执行:publish');
    expect(reload).toHaveBeenCalledTimes(1);

    // 失效口径:所属 collection(回链 articles)重取;无关 rel(comments)零重取。
    expect(await handle.get('articles')).not.toBeNull();
    expect(callsOf('articles')).toHaveLength(2);
    expect(await handle.get('comments')).not.toBeNull();
    expect(callsOf('comments')).toHaveLength(1);
  });

  it('rejected(白名单外)→ 零 /api/exec、零失效、零 reload;告示如实', async () => {
    const execFn = vi.fn<GateExecFn>();
    const gate = createActionGate(execFn); // 零注册:白名单为空
    const invalidateAfterExec = vi.fn();
    const handle: EntityCacheHandle = {
      get: async () => null,
      invalidateAfterExec,
    };
    const notify = vi.fn();
    const reload = vi.fn();
    const handler = createCanvasActionHandler({ gate, cache: handle, notify, reload });

    await handler(action('publish', 'post:p1'));

    expect(execFn).not.toHaveBeenCalled();
    expect(invalidateAfterExec).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('渲染层拒绝'));
  });

  it('refused(裁决层拒)→ 零失效、零 reload;告示携带 layer/reason', async () => {
    const post = instance('post:p1', 'articles');
    const execFn = vi.fn<GateExecFn>().mockResolvedValue({
      ok: false,
      status: 403,
      layer: 'policy',
      reason: 'deny',
    });
    const gate = createActionGate(execFn);
    gate.register(post);
    const invalidateAfterExec = vi.fn();
    const handle: EntityCacheHandle = {
      get: async () => null,
      invalidateAfterExec,
    };
    const notify = vi.fn();
    const reload = vi.fn();
    const handler = createCanvasActionHandler({ gate, cache: handle, notify, reload });

    await handler(action('publish', 'post:p1'));

    expect(execFn).toHaveBeenCalledTimes(1);
    expect(invalidateAfterExec).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('裁决层拒绝:[policy] deny');
  });
});
