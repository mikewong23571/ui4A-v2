'use client';
/**
 * 历史回合当时上下文(T56 P3.3 / US08;design §2「历史上下文」行)。
 * 每个历史回合显式呈现「当时」的线/注视(rel 直出,不猜名称);上下文缺失
 * 的回合显式「当时上下文未知」,禁止用当前 URL/presence 补造(D51 注意力
 * 纪律)。词表与映射在 @/chat/history/turn-context,本组件零推断。
 */
import { turnContextLine, type TurnContextRow } from '@/chat/history/turn-context';

export function TurnContextNotice({ rows }: { rows: readonly TurnContextRow[] }) {
  if (rows.length === 0) return null;
  return (
    <details
      data-testid="turn-context-notice"
      className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
    >
      <summary className="cursor-pointer select-none">历史回合当时上下文</summary>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li
            key={row.turnId}
            data-testid="turn-context-row"
            data-turn-id={row.turnId}
            data-known={row.known ? 'true' : 'false'}
          >
            {turnContextLine(row)}
          </li>
        ))}
      </ul>
    </details>
  );
}
