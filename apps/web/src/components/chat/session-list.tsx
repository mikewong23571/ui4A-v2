/**
 * 历史会话清单(T23 Phase D 自 chat-panel.tsx 拆出):日志投影的只读视图,
 * 打开即重新拉取(清单是日志投影,拉取即最新)。
 */
import type { ChatSession } from './chat-types';

/** 清单时间显示(月-日 时:分;投影字段直出)。 */
function tsBrief(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const OUTCOME_LABEL: Record<string, string> = {
  done: '完成',
  failed: '失败',
  suspended: '待确认',
  'max-steps': '步数上限',
};

export function SessionList({ session }: { session: ChatSession }) {
  if (session.sessions === null) {
    return <p className="py-8 text-center text-xs text-muted-foreground">读取会话清单…</p>;
  }
  if (session.sessions.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground" data-testid="empty-sessions">
        暂无历史会话(回合完成后经事件日志留痕)。
      </p>
    );
  }
  return (
    <ul className="h-full space-y-1 overflow-y-auto px-3 py-3">
      {session.sessions.map((item) => {
        const current = item.sessionId === session.sessionId;
        return (
          <li key={item.sessionId}>
            <button
              type="button"
              data-nav="local:chat-session-open"
              data-rel={item.sessionId}
              aria-current={current ? 'true' : undefined}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                current ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-accent/60'
              }`}
              onClick={() => session.selectSession(item.sessionId)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground">
                  {item.lastGoal !== '' ? item.lastGoal : '(空目标)'}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {tsBrief(item.lastTs)}
                </span>
              </span>
              <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>会话 {item.sessionId.slice(0, 8)}</span>
                <span>·</span>
                <span>{item.turns} 回合</span>
                {item.lastOutcome !== '' && (
                  <>
                    <span>·</span>
                    <span>{OUTCOME_LABEL[item.lastOutcome] ?? item.lastOutcome}</span>
                  </>
                )}
                {current && <span className="text-primary">· 当前</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
