/**
 * 历史回合「当时上下文」的人读映射(T56 P3.3 / D78 决定 5;S2 定案 §2.2)。
 *
 * 显示口径:userContextKnown ∧ clientView 在场才显示「当时」观察(rel 直出,
 * 不做名称猜测——名称解析属当前授权读取,失败回退 rel 的完整形态另行演进);
 * 观察存在但未定位显式「未定位」;两种未知来路(旧版无观察 / user 事件缺失)
 * UI 同形「当时上下文未知」。禁止用当前 URL/presence 给旧回合补造。固定框架
 * 插值,零自然语言解析(D47.1 同纪律)。
 */
import type { RenderSubject } from '@ui4a/shared';

import type { ChatTurn } from '../history';

export interface TurnContextRow {
  turnId: string;
  /** 会话内 1-based 序位(按 seq 升序)。 */
  position: number;
  /** true = 有可证的当时观察(thread/focus 可能仍为 null=未定位);false = 显式未知。 */
  known: boolean;
  thread: string | null;
  focus: RenderSubject | null;
}

export function turnContextRows(turns: readonly ChatTurn[]): TurnContextRow[] {
  return turns.map((turn, index) => ({
    turnId: turn.turnId,
    position: index + 1,
    known: turn.userContextKnown === true && turn.clientView !== undefined,
    thread: turn.clientView?.presence.thread ?? null,
    focus: turn.clientView?.presence.focus ?? null,
  }));
}

function subjectLabel(subject: RenderSubject): string {
  return typeof subject === 'string' ? subject : subject.selection.join('、');
}

export function turnContextLine(row: TurnContextRow): string {
  if (!row.known) return `第 ${row.position} 问 · 当时上下文未知`;
  const parts: string[] = [];
  if (row.thread !== null) parts.push(`线 ${row.thread}`);
  if (row.focus !== null) parts.push(`注视 ${subjectLabel(row.focus)}`);
  return `第 ${row.position} 问 · 当时:${parts.length > 0 ? parts.join(' · ') : '未定位'}`;
}
