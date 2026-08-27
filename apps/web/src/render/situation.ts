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
  ts?: string | null;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: string | null;
  principal: string | null;
  channel: string | null;
  params?: Record<string, unknown>;
  reason?: string | null;
  detail?: unknown;
}

interface EventNarrativeParts {
  verb: string;
  result: string;
}

type EventNarrator = (row: LogEventRow) => EventNarrativeParts;

function detailRecord(row: LogEventRow): Record<string, unknown> {
  return typeof row.detail === 'object' && row.detail !== null && !Array.isArray(row.detail)
    ? (row.detail as Record<string, unknown>)
    : {};
}

function quotedAction(row: LogEventRow): string {
  return row.action !== null ? `「${row.action}」` : '已声明动作';
}

function staticNarrator(verb: string, result = '已记录'): EventNarrator {
  return () => ({ verb, result });
}

/** kind → 机械叙事模板;未知 kind 由 eventSummary 回退原始字段行。 */
const EVENT_NARRATIVE_REGISTRY: Readonly<Record<string, EventNarrator>> = {
  'action-executed': (row) => ({ verb: `执行${quotedAction(row)}`, result: '已完成' }),
  'action-rejected': (row) => ({
    verb: `执行${quotedAction(row)}`,
    result: `已拒绝${row.reason !== null && row.reason !== undefined ? `：${row.reason}` : ''}`,
  }),
  'entity-appended': staticNarrator('新增实体', '已写入'),
  'spawn-requested': staticNarrator('请求启动能力', '已排队'),
  'confirmation-requested': staticNarrator('请求人类确认', '待处理'),
  'confirmation-approved': staticNarrator('批准确认', '已批准'),
  'confirmation-rejected': (row) => ({
    verb: '拒绝确认',
    result: `已拒绝${row.reason !== null && row.reason !== undefined ? `：${row.reason}` : ''}`,
  }),
  'notification-delivered': staticNarrator('发送确认通知', '已送达'),
  seed: staticNarrator('装载业务种子', '已完成'),
  'definition-seeded': staticNarrator('装载流程定义', '已激活'),
  'application-seeded': staticNarrator('装载应用定义', '已激活'),
  'capability-seeded': staticNarrator('装载能力定义', '已注册'),
  'definition-edited': staticNarrator('编辑流程定义'),
  'definition-submitted': staticNarrator('提交流程定义', '待裁决'),
  'definition-activated': staticNarrator('激活流程定义', '已激活'),
  'definition-rejected': (row) => ({
    verb: '裁决流程定义',
    result: `已拒绝${row.reason !== null && row.reason !== undefined ? `：${row.reason}` : ''}`,
  }),
  'definition-revised': staticNarrator('修订流程定义', '已更新'),
  'definition-deprecated': staticNarrator('停用流程定义', '已停用'),
  'delegation-started': staticNarrator('启动委托', '执行中'),
  'delegation-step': (row) => {
    const step = detailRecord(row).step;
    return { verb: `执行委托步骤${typeof step === 'number' ? ` ${step}` : ''}`, result: '已记录' };
  },
  'delegation-completed': staticNarrator('执行委托', '已完成'),
  'delegation-failed': (row) => ({
    verb: '执行委托',
    result: `已失败${row.reason !== null && row.reason !== undefined ? `：${row.reason}` : ''}`,
  }),
  'delegation-max-steps': staticNarrator('执行委托', '达到步数上限'),
  'plan-executed': staticNarrator('批量执行计划', '已完成'),
  'render-spec-frozen': staticNarrator('凝固渲染说明', '已保存'),
  'meta-bootstrap-applied': staticNarrator('安装应用制品', '已完成'),
  'chat-turn-started': (row) => {
    const goal = detailRecord(row).goal;
    const verb =
      typeof goal === 'object' &&
      goal !== null &&
      !Array.isArray(goal) &&
      typeof (goal as Record<string, unknown>).verb === 'string'
        ? (goal as Record<string, unknown>).verb
        : '未标注目标';
    return { verb: `开始聊天回合「${verb}」`, result: '执行中' };
  },
  'chat-turn-progress': (row) => {
    const step = detailRecord(row).step;
    const number =
      typeof step === 'object' &&
      step !== null &&
      !Array.isArray(step) &&
      typeof (step as Record<string, unknown>).step === 'number'
        ? ` ${(step as Record<string, unknown>).step}`
        : '';
    return { verb: `记录聊天进展${number}`, result: '已保存' };
  },
  'chat-turn': (row) => {
    const detail = detailRecord(row);
    const goal = detail.goal;
    const verb =
      typeof goal === 'object' &&
      goal !== null &&
      !Array.isArray(goal) &&
      typeof (goal as Record<string, unknown>).verb === 'string'
        ? (goal as Record<string, unknown>).verb
        : '未标注目标';
    const outcome = detail.outcome;
    const result =
      outcome === 'done' ? '已完成' : outcome === 'max-steps' ? '达到步数上限' : '已失败';
    return { verb: `聊天回合「${verb}」`, result };
  },
  'agent-decision': (row) => {
    const detail = detailRecord(row);
    const op = detail.op;
    const operation =
      typeof op === 'object' &&
      op !== null &&
      !Array.isArray(op) &&
      typeof (op as Record<string, unknown>).kind === 'string'
        ? (op as Record<string, unknown>).kind
        : 'unknown';
    const step = typeof detail.step === 'number' ? detail.step : '?';
    const driver = typeof detail.driver === 'string' ? detail.driver : 'unknown';
    return { verb: `第 ${step} 步决策(${driver})：${operation}`, result: '已记录' };
  },
};

function actorLabel(row: LogEventRow): string {
  const principal = row.principal !== null ? `(${row.principal})` : '';
  if (row.actor === 'human') return `人类${principal}`;
  if (row.actor === 'agent') return `Agent${principal}`;
  return '系统';
}

/** 单事件机械摘要:已知 kind 走注册模板,未知 kind 回退原始字段行。 */
export function eventSummary(row: LogEventRow): string {
  const narrator = EVENT_NARRATIVE_REGISTRY[row.kind];
  if (narrator === undefined) {
    return [
      `kind=${row.kind}`,
      `rel=${row.rel ?? '-'}`,
      `action=${row.action ?? '-'}`,
      `actor=${row.actor ?? '-'}`,
    ].join(' · ');
  }
  const narrative = narrator(row);
  return `${actorLabel(row)} · ${row.rel ?? '系统'} · ${narrative.verb} · ${narrative.result}`;
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

/** 执行中委托 = delegations 集合成员 status=running 计数(集合投影,零 AI)。 */
export function runningDelegationsOf(fleet: SirenEntity): number {
  return (fleet.entities ?? []).filter((member) => member.properties.status === 'running').length;
}

/**
 * 事件日志行 → timeline 词条成员:机械摘要 + 时间戳 + 原始审计层。
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
      summary: eventSummary(row),
      ...(row.ts !== undefined && row.ts !== null ? { timestamp: row.ts } : {}),
      audit: {
        seq: row.seq,
        ts: row.ts ?? null,
        kind: row.kind,
        rel: row.rel,
        action: row.action,
        actor: row.actor,
        principal: row.principal,
        channel: row.channel,
        params: row.params ?? {},
        reason: row.reason ?? null,
        detail: row.detail ?? null,
      },
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
