/**
 * 态势投影(T7 Phase B / spec 架构决定 5):主页骨架的静态绑定层。
 *
 * 骨架路径与生成路径的隔离(架构决定 4):本模块绑定**写死在代码里**
 * (零 AI,不经 freezeSpec/生成通道——审计通道隔离);但同走 binding-only
 * 剃刀:stat 的 value 是字段引用,数值经 deref 从实体投影取回——
 * "模型发不出一个数字"在骨架同样成立,态势数字与实体 count 逐项相等
 * (组件测试对拍)。页面标注(chrome 文案)是代码不是 spec 载荷。
 */
import type { SirenEntity } from '@ui4a/engine';

import type { EntityCache } from './deref';
import type { RenderSpec } from './spec';

/** /api/events 的日志行(端点合同形状)。 */
export interface LogEventRow {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: string | null;
  principal: string | null;
  channel: string | null;
}

/** 态势 stat 的静态绑定(主页骨架;bind 全字段引用,零字面)。 */
export interface SituationStatBinds {
  pending: RenderSpec;
  articles: RenderSpec;
}

/** 待确认/文章数的 stat bind(inbox.count / articles.count 字段引用)。 */
export function situationStatBinds(): SituationStatBinds {
  return {
    pending: {
      concern: 'home-stat-inbox-pending',
      component: 'stat',
      bind: { value: { field: 'inbox.count' } },
    },
    articles: {
      concern: 'home-stat-articles-count',
      component: 'stat',
      bind: { value: { field: 'articles.count' } },
    },
  };
}

/** 在飞委托 = delegations 集合成员 status=running 计数(集合投影,零 AI)。 */
export function runningDelegationsOf(fleet: SirenEntity): number {
  return (fleet.entities ?? []).filter((member) => member.properties.status === 'running').length;
}

/**
 * 事件日志行 → timeline 词条成员(Siren 成员形状;字段原样直出,零发明)。
 * tail:N 缺省全量;给 N 时取尾部保 seq 序(最近 N 事件)。
 */
export function eventsToMembers(rows: readonly LogEventRow[], tail?: number): SirenEntity[] {
  const selected = tail === undefined ? [...rows] : rows.slice(Math.max(0, rows.length - tail));
  return selected.map((row) => ({
    class: ['event'],
    rel: ['item'],
    properties: {
      seq: row.seq,
      kind: row.kind,
      ...(row.rel !== null ? { rel: row.rel } : {}),
      ...(row.action !== null ? { action: row.action } : {}),
      ...(row.actor !== null ? { actor: row.actor } : {}),
      ...(row.principal !== null ? { principal: row.principal } : {}),
      ...(row.channel !== null ? { channel: row.channel } : {}),
    },
    actions: [],
    links: [],
  }));
}

/** 态势缓存的便捷拉取清单(骨架页取数用;实体合同路径)。 */
export const SITUATION_RELS = ['articles', 'comments', 'inbox', 'delegations'] as const;

/** 从缓存取实体(骨架取数失败容错:缺实体返回 null,页面如实降级)。 */
export function entityOf(cache: EntityCache, rel: string): SirenEntity | null {
  return cache.get(rel) ?? null;
}
