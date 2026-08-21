'use client';
/**
 * 委托舰队页(T5 Phase B / spec 架构决定 5、验收 5):GET /api/delegations 的
 * 人类监控视图——一行一委托(goal/status/步数/成功/摘要,时间无关),
 * 人类监控成本不随并行委托数 N 超线性(arch-brief §9.3)。
 *
 * - 数据源:/api/delegations(事件日志聚合;与引擎合同同一真相);
 * - 自动轮询(3s)零操作刷新 + 手动刷新按钮;running 委托会自行推进;
 * - 极简表格,无任何可提交合同元素(委托动作发生在 worker,不经此页)。
 */
import { useCallback, useEffect, useState } from 'react';

/** /api/delegations 的舰队行(时间无关摘要;与后端 DelegationRow 同形)。 */
interface FleetRow {
  id: string;
  goal: { verb: string; fields?: Record<string, unknown> };
  status: 'running' | 'completed' | 'failed' | 'max-steps';
  steps: number;
  successes: number;
  summary?: string;
  reason?: string;
}

/** 轮询间隔(委托以 activity 步进,秒级刷新足够;极简不引入 SSE/长轮询)。 */
const POLL_MS = 3000;

const STATUS_LABEL: Record<FleetRow['status'], string> = {
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  'max-steps': '步数上限',
};

/** 状态色(组件测试以 data-status + class 断言;e2e/走查同锚点)。 */
const STATUS_COLOR: Record<FleetRow['status'], string> = {
  running: 'text-blue-600',
  completed: 'text-green-600',
  failed: 'text-red-600',
  'max-steps': 'text-amber-600',
};

/** 目标文本:动词 + 字段值(title/resource 等标量)。 */
function goalText(goal: FleetRow['goal']): string {
  const parts = [goal.verb];
  for (const value of Object.values(goal.fields ?? {})) {
    if (typeof value === 'string' && value !== '') parts.push(value);
  }
  return parts.join(' · ');
}

/** 委托短标识:剥 delegation- 前缀后取 uuid 前 8 位(与悬浮窗回执同口径)。 */
function idBrief(id: string): string {
  return id.replace(/^delegation-/, '').slice(0, 8);
}

export default function DelegationsPage() {
  const [rows, setRows] = useState<FleetRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/delegations');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { delegations?: FleetRow[] };
      setRows(body.delegations ?? []);
      setFailed(false);
    } catch {
      setFailed(true); // 如实提示,不粉饰
    }
  }, []);

  useEffect(() => {
    // 初拉经 0ms 定时器出 effect 同步路径(react-hooks/set-state-in-effect:
    // load 含 setState,不得在 effect 体内同步直呼);轮询每 3s 一拉。
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);

  const running = (rows ?? []).filter((row) => row.status === 'running').length;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">委托舰队</h1>
        <button
          type="button"
          aria-label="刷新"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          onClick={() => void load()}
        >
          刷新
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        委托 = Temporal workflow · 事件日志即轨迹 · 每 {POLL_MS / 1000}s 自动刷新
        {rows !== null ? ` · 执行中 ${running}` : ''}
      </p>

      {failed && <p className="mt-6 text-sm text-red-600">读取舰队失败(服务不可用)。</p>}
      {!failed && rows === null && <p className="mt-6 text-sm text-zinc-500">加载中…</p>}

      {rows !== null && rows.length === 0 && (
        <p className="mt-6 text-sm text-zinc-500" data-testid="empty-fleet">
          暂无委托
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="py-2 pr-4">目标</th>
              <th className="py-2 pr-4">状态</th>
              <th className="py-2 pr-4">步数</th>
              <th className="py-2 pr-4">成功</th>
              <th className="py-2">摘要</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 align-top" data-delegation={row.id}>
                <td className="py-2 pr-4">
                  <span className="font-medium text-zinc-800">{goalText(row.goal)}</span>
                  <span className="ml-2 text-xs text-zinc-400">{idBrief(row.id)}</span>
                </td>
                <td className="py-2 pr-4">
                  <span data-status={row.status} className={STATUS_COLOR[row.status]}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td className="py-2 pr-4 text-zinc-700">{row.steps}</td>
                <td className="py-2 pr-4 text-zinc-700">{row.successes}</td>
                <td className="py-2 text-zinc-600">{row.summary ?? row.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
