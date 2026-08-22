'use client';
/**
 * assistant 工作台面板(T9 Phase B):悬浮窗(float)、sidebar 与独立窗口
 * (/chat)三形态共用的聊天会话本体。会话状态由 useChatSession 持有(聊天 = 事件日志的投影,
 * 服务端零会话态):
 *
 * - 发送(B1 流式轨迹):POST /api/chat——inline 返回 SSE 流,step 帧逐步
 *   追加 assistant 消息(每步一条,废弃一次性 join);thinking-delta 帧
 *   (推理增量)同号原地累积,thinking 帧(T11 Phase C)为聚合权威终帧,
 *   先于同号 step 帧到达并替换累积(归步成可折叠「思考」区,默认收起;
 *   rule 路径零思考帧);render 帧(渲染短路 LLM 路径 SSE 化)与一次性
 *   JSON 回执同形处置;final 帧更新 sessionId(localStorage 持久化,纯投影)
 *   与 render 回执;整体超时 120s 如实报错;
 * - 停止(B2):onCancel 挂 AbortController 中止 fetch,追加「已停止(仅中断
 *   展示,服务端轨迹已在事件日志留痕)」——循环在服务端跑完并落 chat-turn;
 * - 历史(B3):挂载时按 localStorage 的 sessionId 拉 /api/chat/history,
 *   各回合 messages 重放进消息列表(goal 作为 user 消息在前);「新会话」
 *   清 localStorage + 清空消息(历史仍在日志,审计不丢);
 * - render 回执(S5):回执即达即跳——router.push 客户端导航到画布 URL
 *   (与点击链接同路:main 内容区切换,面板不重挂载;已在目标地址则跳过);
 *   底部保留「在画布查看:<concern>」链接(data-nav="render:<concern>",
 *   手动回入口,不在画布时主窗口导航过去,sidebar 与画布同屏即协同);
 * - 委托模式(T5 Phase B):开关打开后发送 mode:'delegated',立即回执
 *   「已派发委托 <id前8位>…(后台执行中),进度见舰队页 /delegations」。
 *
 * UI:assistant-ui 官方 stock thread 裁剪版(@/components/assistant-ui/thread)
 * + shadcn Button;消息态经 useExternalStoreRuntime 外接。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';

import type { ChatSessionSummary, ChatTurn } from '@/chat/history';
import type { ChatRenderPayload } from '@/chat/sse';
import { anySignal, createIdleTimeout, readChatSseStream, type ChatFinalPayload } from '@/chat/sse';
import { ChatThread } from '@/components/assistant-ui/thread';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  History,
  PanelRight,
  PictureInPicture2,
  SquareArrowOutUpRight,
  SquarePen,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** 面板内消息(rel 为轨迹步的实体 rel:flow 徽章展示用,见 thread.tsx)。 */
interface ChatUiMessage {
  role: 'user' | 'assistant';
  content: string;
  rel?: string;
  /** 思考区条目(T11 Phase C):值为归步步号,content 为该步推理自述全文。 */
  thinking?: number;
}

/** 一次性 JSON 响应形状(render 短路/兼容路径;inline 已转 SSE)。 */
interface ChatJsonResponse {
  sessionId?: string;
  outcome?: string;
  summary?: string | null;
  messages?: { role: 'assistant'; text: string }[];
  render?: {
    concern: string;
    canvasUrl: string;
  };
  focus?: { rel: string; canvasUrl: string };
  error?: string;
}

/** /api/chat mode=delegated 的派发回执(T5 Phase B)。 */
interface DelegatedResponse {
  mode?: 'delegated';
  delegationId?: string;
  sessionId?: string;
}

const SESSION_STORAGE_KEY = 'ui4a.chat.sessionId';

/** 思考过程可见性开关的持久化键('0' = 关闭;缺省/其他 = 开启)。 */
const THINKING_STORAGE_KEY = 'ui4a.chat.thinking';

function loadThinkingPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(THINKING_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** 客户端流空闲超时:有效帧/heartbeat 会续期，不再把总时长误判为超时。 */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

function loadSessionId(): string {
  try {
    return globalThis.localStorage?.getItem(SESSION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function convertMessage(message: ChatUiMessage): ThreadMessageLike {
  const custom: Record<string, unknown> = {};
  if (message.rel !== undefined) custom['rel'] = message.rel;
  if (message.thinking !== undefined) custom['thinking'] = message.thinking;
  return {
    role: message.role,
    content: [{ type: 'text', text: message.content }],
    ...(Object.keys(custom).length > 0 ? { metadata: { custom } } : {}),
  };
}

export interface ChatSession {
  sessionId: string;
  isRunning: boolean;
  delegated: boolean;
  /** 思考过程可见性(用户开关,持久化;关闭 = 思考条目不渲染,state 保留)。 */
  showThinking: boolean;
  lastRender: { concern: string; canvasUrl: string } | undefined;
  /** agent 当前查看的实体引用（临时共享处境，不是凝固布局）。 */
  lastFocus: { rel: string; canvasUrl: string } | undefined;
  toggleDelegated: () => void;
  toggleShowThinking: () => void;
  startNewSession: () => void;
  runtime: ReturnType<typeof useExternalStoreRuntime>;
  /** 会话清单视图(T9 补):'chat' 会话态 / 'sessions' 清单态。 */
  view: 'chat' | 'sessions';
  /** 清单数据(null = 未加载/加载中;[] = 空态)。 */
  sessions: ChatSessionSummary[] | null;
  /** 打开清单视图(每次重新拉取——清单是日志投影,拉取即最新)。 */
  openSessions: () => void;
  /** 返回会话视图。 */
  closeSessions: () => void;
  /** 切换到指定历史会话(持久化 sessionId + 重放该会话回合)。 */
  selectSession: (sessionId: string) => void;
}

/** 聊天会话状态 + 运行时(sidebar 壳与 /chat 独立页共用同一逻辑)。 */
export function useChatSession(): ChatSession {
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const sessionRef = useRef('');
  // 委托模式(ref 镜像:onNew 回调零依赖 memo,发送时读 ref 防闭包过期)。
  const [delegated, setDelegated] = useState(false);
  const delegatedRef = useRef(false);
  // 思考过程可见性(用户开关):关闭时思考条目不渲染(消息保留在 state,
  // 重开即回——纯展示层过滤)。持久化 ui4a.chat.thinking,缺省开启;与委托
  // 开关同住壳层(悬浮/分栏形态切换 ChatPanel 重挂载,状态在壳上不丢)。
  const [showThinking, setShowThinking] = useState(loadThinkingPreference);
  // 最近一次渲染回执(S5:surface 引用的可点形态——点击在画布打开)。
  const [lastRender, setLastRender] = useState<ChatJsonResponse['render']>(undefined);
  const [lastFocus, setLastFocus] = useState<ChatJsonResponse['focus']>(undefined);
  // 进行中请求的取消柄(B2:onCancel 中止 fetch;整体超时经 AbortSignal.any 合并)。
  const abortRef = useRef<AbortController | null>(null);
  // 高频 reasoning delta 先在 ref 聚合，每 50ms 至多提交一次 React state。
  const thinkingDeltaRef = useRef(new Map<number, string>());
  const thinkingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [view, setView] = useState<'chat' | 'sessions'>('chat');
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);

  const persistSession = useCallback((next: string) => {
    if (next === '' || next === sessionRef.current) return;
    sessionRef.current = next;
    setSessionId(next);
    try {
      globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, next);
    } catch {
      // localStorage 不可用(隐私模式等):会话退化为内存态,无损
    }
  }, []);

  /** 拉取指定会话的历史回合并重放进消息列表(goal 作为 user 消息在前)。 */
  const restoreSession = useCallback((stored: string) => {
    if (stored === '') return;
    let cancelled = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const load = (): void => {
      fetch(`/api/chat/history?sessionId=${encodeURIComponent(stored)}`)
        .then(async (response) => {
          if (!response.ok) return { turns: [] };
          return (await response.json()) as { turns?: ChatTurn[] };
        })
        .then((body) => {
          if (cancelled) return;
          const turns = body.turns ?? [];
          const replayed: ChatUiMessage[] = [];
          for (const turn of turns) {
            replayed.push({ role: 'user', content: turn.goal.verb });
            for (const entry of turn.messages) {
              replayed.push({ role: 'assistant', content: entry.text });
            }
          }
          setMessages(replayed);
          const running = turns.some((turn) => turn.status === 'running');
          setIsRunning(running);
          // 已保存 session 但日志尚空也可能是刷新撞在 POST 首写之前，继续追投影。
          if (running || turns.length === 0) poll = setTimeout(load, 1_000);
        })
        .catch(() => {
          if (!cancelled) poll = setTimeout(load, 1_000);
        });
    };
    load();
    // 卸载/切换会话时作废旧拉取(竞态口径:后到者不覆盖新会话)。
    return () => {
      cancelled = true;
      if (poll !== undefined) clearTimeout(poll);
    };
  }, []);

  // 挂载:恢复 localStorage 的 sessionId 并重放历史(B3;历史 = chat-turn 投影)。
  // setSessionId 经 0ms 定时器出 effect 同步路径(react-hooks/set-state-in-effect;
  // 与舰队页同口径),历史重放的 setState 本就在异步回调。
  useEffect(() => {
    const stored = loadSessionId();
    sessionRef.current = stored;
    // 仅当会话未被随后的回合推进(ref 已被 persistSession 改写)时才落初始标签,
    // 防 0ms 定时器以旧值覆盖新会话。
    const initial = setTimeout(() => {
      if (sessionRef.current === stored) setSessionId(stored);
    }, 0);
    const cleanupRestore = restoreSession(stored);
    return () => {
      clearTimeout(initial);
      cleanupRestore?.();
    };
  }, [restoreSession]);

  const appendAssistant = useCallback((content: string, rel?: string) => {
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content, ...(rel !== undefined ? { rel } : {}) },
    ]);
  }, []);

  const flushThinkingDeltas = useCallback(() => {
    if (thinkingFlushRef.current !== null) clearTimeout(thinkingFlushRef.current);
    thinkingFlushRef.current = null;
    const pending = [...thinkingDeltaRef.current.entries()];
    thinkingDeltaRef.current.clear();
    if (pending.length === 0) return;
    setMessages((prev) => {
      const next = [...prev];
      for (const [step, text] of pending) {
        let found = false;
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index]!.thinking === step) {
            next[index] = { ...next[index]!, content: next[index]!.content + text };
            found = true;
            break;
          }
        }
        if (!found) next.push({ role: 'assistant', content: text, thinking: step });
      }
      return next;
    });
  }, []);

  /** thinking-delta 帧:同号先合帧，避免 token 速率直接放大为整棵 thread 重渲染。 */
  const appendThinkingDelta = useCallback(
    (step: number, piece: string) => {
      thinkingDeltaRef.current.set(step, (thinkingDeltaRef.current.get(step) ?? '') + piece);
      if (thinkingFlushRef.current === null) {
        thinkingFlushRef.current = setTimeout(flushThinkingDeltas, 50);
      }
    },
    [flushThinkingDeltas],
  );

  /**
   * thinking 帧(T11 Phase C):聚合整段权威终帧——同号条目替换为全文
   * (兼容增量丢失/关闭后补放),无同步号条目时独立成条。
   */
  const appendThinking = useCallback((step: number, text: string) => {
    // 聚合终帧是权威全文：丢弃尚未提交的同号片段，避免先追加后替换的双渲染。
    thinkingDeltaRef.current.delete(step);
    setMessages((prev) => {
      for (let index = prev.length - 1; index >= 0; index -= 1) {
        if (prev[index]!.thinking === step) {
          const next = [...prev];
          next[index] = { role: 'assistant', content: text, thinking: step };
          return next;
        }
      }
      return [...prev, { role: 'assistant', content: text, thinking: step }];
    });
  }, []);

  useEffect(
    () => () => {
      if (thinkingFlushRef.current !== null) clearTimeout(thinkingFlushRef.current);
    },
    [],
  );

  /** SSE 帧处置:step 逐步追加;final 更新会话/回执;error 如实进消息。 */
  const handleFinal = useCallback(
    (payload: ChatFinalPayload, stepCount: number) => {
      persistSession(payload.sessionId);
      // 零轨迹步的失败(如起始实体不可得):步帧为空,以 final.summary 补一条,
      // 与旧一次性 JSON 客户端的兜底口径一致。
      if (stepCount === 0 && payload.summary !== null && payload.summary !== '') {
        appendAssistant(
          payload.outcome === 'failed' ? `失败: ${payload.summary}` : payload.summary,
        );
      }
    },
    [appendAssistant, persistSession],
  );

  /**
   * 渲染回执处置(render 帧与一次性 JSON 回执同形):会话持久化 + 画布入口
   * (lastRender,即达即跳/手动链接共用)+ 回执消息。auto-nav 经 setLastRender
   * 触发,两路(帧/JSON)零差别。
   */
  const handleRenderReceipt = useCallback(
    (payload: ChatRenderPayload) => {
      persistSession(payload.sessionId);
      setLastFocus(undefined);
      setLastRender(payload.render);
      for (const entry of payload.messages) appendAssistant(entry.text);
    },
    [appendAssistant, persistSession],
  );

  const handleFocus = useCallback((rel: string) => {
    setLastRender(undefined);
    setLastFocus({ rel, canvasUrl: `/canvas?focus=${encodeURIComponent(rel)}` });
  }, []);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const part = message.content[0];
      if (part?.type !== 'text') throw new Error('仅支持文本目标');
      const goal = part.text.trim();
      if (goal === '') return;

      const activeSession = sessionRef.current || crypto.randomUUID();
      const turnId = crypto.randomUUID();
      persistSession(activeSession);

      setMessages((prev) => [...prev, { role: 'user', content: goal }]);
      setIsRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const idleTimeout = createIdleTimeout(STREAM_IDLE_TIMEOUT_MS);
      const signal = anySignal([controller.signal, idleTimeout.signal]);
      let stepCount = 0;
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            goal: { verb: goal },
            sessionId: activeSession,
            turnId,
            ...(delegatedRef.current ? { mode: 'delegated' } : {}),
          }),
          signal,
        });
        idleTimeout.touch();
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream')) {
          // inline(B1):SSE 流——每步一条 assistant 消息,逐步呈现;thinking
          // 帧(T11)先于同号 step 帧到达,归步成可折叠思考区(不落 else 误伤)。
          if (response.body === null) throw new Error('SSE 响应缺少 body');
          await readChatSseStream(response.body, signal, (frame) => {
            idleTimeout.touch();
            if (frame.type === 'session') {
              persistSession(frame.sessionId);
            } else if (frame.type === 'heartbeat') {
              return;
            } else if (frame.type === 'focus') {
              handleFocus(frame.rel);
            } else if (frame.type === 'thinking-delta') {
              appendThinkingDelta(frame.step, frame.text);
            } else if (frame.type === 'thinking') {
              appendThinking(frame.step, frame.text);
            } else if (frame.type === 'step') {
              flushThinkingDeltas();
              stepCount += 1;
              appendAssistant(frame.message.text, frame.rel);
            } else if (frame.type === 'render') {
              // 渲染回执帧(渲染短路 LLM 路径 SSE 化):处置与 JSON 回执等价。
              handleRenderReceipt(frame.payload);
            } else if (frame.type === 'final') {
              flushThinkingDeltas();
              handleFinal(frame.payload, stepCount);
            } else if (frame.type === 'error') {
              appendAssistant(`失败: ${frame.error}`);
            }
            // 未知帧类型:忽略(协议前向兼容——旧客户端对新帧零误伤口径)。
          });
          return;
        }

        // 一次性 JSON:委托派发回执 / render 短路 / 参数错误 / 兼容旧 inline 形状。
        const body = (await response.json()) as ChatJsonResponse & DelegatedResponse;
        if (body.mode === 'delegated' && typeof body.delegationId === 'string') {
          if (body.sessionId !== undefined) persistSession(body.sessionId);
          appendAssistant(
            `已派发委托 ${body.delegationId.replace(/^delegation-/, '').slice(0, 8)}…(后台执行中),进度见委托监控页 /delegations`,
          );
          return;
        }
        if (body.sessionId !== undefined) persistSession(body.sessionId);
        // render 回执(S5):展示意图 → 画布入口链接(替换上一条渲染回执)。
        setLastRender(body.render ?? undefined);
        setLastFocus(body.focus ?? undefined);
        if (body.messages !== undefined && body.messages.length > 0) {
          for (const entry of body.messages) appendAssistant(entry.text);
        } else {
          appendAssistant(`失败: ${body.error ?? body.summary ?? `HTTP ${response.status}`}`);
        }
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'AbortError') {
          // B2 停止:仅中断展示;服务端循环跑完,轨迹经 chat-turn 事件留痕。
          appendAssistant('已停止(仅中断展示,服务端轨迹已在事件日志留痕)');
        } else if (name === 'TimeoutError') {
          appendAssistant('失败: 连接空闲超时(120s 未收到任何进展或心跳;服务端轨迹仍在事件日志留痕)');
        } else {
          appendAssistant(`失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        idleTimeout.dispose();
        abortRef.current = null;
        setIsRunning(false);
      }
    },
    [appendAssistant, appendThinking, appendThinkingDelta, flushThinkingDeltas, handleFinal, handleFocus, handleRenderReceipt, persistSession],
  );

  const onCancel = useCallback(async () => {
    abortRef.current?.abort();
  }, []);

  const toggleDelegated = useCallback(() => {
    const next = !delegatedRef.current;
    delegatedRef.current = next;
    setDelegated(next);
  }, []);

  /** 思考过程可见性开关:持久化到 localStorage(隐私模式退化为内存态,无损)。 */
  const toggleShowThinking = useCallback(() => {
    setShowThinking((prev) => {
      const next = !prev;
      try {
        globalThis.localStorage?.setItem(THINKING_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // 同上
      }
      return next;
    });
  }, []);

  // 新会话(B3):清 localStorage + 清空消息;历史仍在事件日志(审计不丢),
  // 旧会话经「历史会话」清单随时可回读。
  const startNewSession = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = '';
    setSessionId('');
    setMessages([]);
    setLastRender(undefined);
    setLastFocus(undefined);
    setView('chat');
    try {
      globalThis.localStorage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // 同上:隐私模式退化,无损
    }
  }, []);

  // 会话清单(T9 补):打开即重新拉取(清单是日志投影,拉取即最新)。
  const openSessions = useCallback(() => {
    setView('sessions');
    setSessions(null);
    fetch('/api/chat/sessions')
      .then(async (response) => {
        if (!response.ok) return { sessions: [] };
        return (await response.json()) as { sessions?: ChatSessionSummary[] };
      })
      .then((body) => setSessions(body.sessions ?? []))
      .catch(() => setSessions([])); // 投影缺失按空态呈现,日志仍是真相
  }, []);

  const closeSessions = useCallback(() => setView('chat'), []);

  /** 切换会话:中止在途请求,换 sessionId(持久化),重放该会话回合。 */
  const selectSession = useCallback(
    (next: string) => {
      setView('chat');
      if (next === sessionRef.current) return;
      abortRef.current?.abort();
      setIsRunning(false);
      sessionRef.current = next;
      setSessionId(next);
      try {
        globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, next);
      } catch {
        // 隐私模式退化为内存态
      }
      setMessages([]);
      setLastRender(undefined);
      setLastFocus(undefined);
      restoreSession(next);
    },
    [restoreSession],
  );

  const runtime = useExternalStoreRuntime({
    isRunning,
    // 思考开关关闭时过滤思考条目(state 保留,重开即回;纯展示层过滤,
    // 不动 thread 组件树)。
    messages: showThinking ? messages : messages.filter((entry) => entry.thinking === undefined),
    convertMessage,
    onNew,
    onCancel,
  });

  return {
    sessionId,
    isRunning,
    delegated,
    showThinking,
    lastRender,
    lastFocus,
    toggleDelegated,
    toggleShowThinking,
    startNewSession,
    runtime,
    view,
    sessions,
    openSessions,
    closeSessions,
    selectSession,
  };
}

// ---- 历史会话清单(日志投影的只读视图)---------------------------------------

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
  'max-steps': '步数上限',
};

function SessionList({ session }: { session: ChatSession }) {
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

// ---- 面板壳(头部 + 消息区/会话清单 + render 回执)-----------------------------

interface ChatPanelProps {
  /** float:右下悬浮窗(带分栏切换);sidebar:右侧分栏(带悬浮切换);window:/chat 独立窗口(全屏)。 */
  variant: 'float' | 'sidebar' | 'window';
  session: ChatSession;
  onClose?: () => void;
  onPopout?: () => void;
  /** float → sidebar(分栏停靠)。 */
  onDock?: () => void;
  /** sidebar → float(悬浮窗)。 */
  onFloat?: () => void;
}

export function ChatPanel({
  variant,
  session,
  onClose,
  onPopout,
  onDock,
  onFloat,
}: ChatPanelProps) {
  const router = useRouter();
  // render 回执即达即跳:与点击底部「在画布查看」等价的编程式客户端导航
  // (main 内容区切画布,本面板在 root layout 侧不重挂载,同屏协同);目标与
  // 当前地址相同(重复回执)则跳过——不重复入历史。仅 onNew 的一次性 JSON
  // 路径会 setLastRender,历史回放/刷新不触发。
  const lastRender = session.lastRender;
  useEffect(() => {
    if (lastRender === undefined) return;
    if (`${window.location.pathname}${window.location.search}` === lastRender.canvasUrl) {
      return;
    }
    router.push(lastRender.canvasUrl);
  }, [lastRender, router]);
  const lastFocus = session.lastFocus;
  useEffect(() => {
    if (lastFocus === undefined) return;
    if (`${window.location.pathname}${window.location.search}` === lastFocus.canvasUrl) return;
    router.push(lastFocus.canvasUrl);
  }, [lastFocus, router]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-sm font-semibold text-foreground">
          UI4A 助手
          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
            {session.sessionId === '' ? '新会话' : `会话 ${session.sessionId.slice(0, 8)}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="新会话"
            title="新会话"
            data-nav="local:chat-new"
            onClick={session.startNewSession}
          >
            <SquarePen />
          </Button>
          {session.view === 'chat' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="历史会话"
              title="历史会话"
              data-nav="local:chat-sessions"
              onClick={session.openSessions}
            >
              <History />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="返回会话"
              title="返回会话"
              data-nav="local:chat-back"
              onClick={session.closeSessions}
            >
              <ArrowLeft />
            </Button>
          )}
          {variant === 'float' && onDock !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="分栏"
              title="分栏(停靠右侧)"
              data-nav="local:chat-dock"
              onClick={onDock}
            >
              <PanelRight />
            </Button>
          )}
          {variant === 'sidebar' && onFloat !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="悬浮"
              title="悬浮窗"
              data-nav="local:chat-float"
              onClick={onFloat}
            >
              <PictureInPicture2 />
            </Button>
          )}
          {variant !== 'window' && onPopout !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="独立窗口"
              title="独立窗口"
              data-nav="local:chat-popout"
              onClick={onPopout}
            >
              <SquareArrowOutUpRight />
            </Button>
          )}
          {variant !== 'window' && onClose !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="收起聊天窗"
              title="收起"
              data-nav="local:chat-close"
              onClick={onClose}
            >
              <X />
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {session.view === 'sessions' ? (
          <SessionList session={session} />
        ) : (
          <AssistantRuntimeProvider runtime={session.runtime}>
            <ChatThread
              delegated={session.delegated}
              onToggleDelegated={session.toggleDelegated}
              showThinking={session.showThinking}
              onToggleShowThinking={session.toggleShowThinking}
            />
          </AssistantRuntimeProvider>
        )}
      </div>
      {/* render 回执入口(S5):点击在画布打开该 surface(Link 客户端导航——
          layout 不重挂载,聊天面板保持打开,与画布同屏协同)。 */}
      {session.lastRender !== undefined && (
        <Link
          href={session.lastRender.canvasUrl}
          data-nav={`render:${session.lastRender.concern}`}
          className="border-t border-border px-3 py-2 text-xs font-medium text-primary hover:underline"
        >
          在画布查看:{session.lastRender.concern}
        </Link>
      )}
      {session.lastFocus !== undefined && (
        <Link
          href={session.lastFocus.canvasUrl}
          data-nav={`focus:${session.lastFocus.rel}`}
          className="border-t border-border px-3 py-2 text-xs font-medium text-primary hover:underline"
        >
          当前查看:{session.lastFocus.rel}
        </Link>
      )}
    </div>
  );
}
