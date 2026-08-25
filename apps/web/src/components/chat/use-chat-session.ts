'use client';
/**
 * 聊天会话状态 hook(T23 Phase D 自 chat-panel.tsx 拆出):悬浮窗(float)、
 * sidebar 与独立窗口(/chat)三形态共用的会话逻辑。会话状态由本 hook 持有
 * (聊天 = 事件日志的投影,服务端零会话态):
 *
 * - 发送(B1 流式轨迹):POST /api/chat——inline 返回 SSE 流,step 帧逐步
 *   追加 assistant 消息(每步一条,废弃一次性 join);thinking-delta 帧
 *   (推理增量)按 `(turnId, step)` 原地累积,thinking 帧为聚合权威终帧,
 *   先于同号 step 帧到达并替换累积(T24 Phase B:条目原样进 thread,由
 *   thread.tsx 呈现为默认折叠、可展开看实时增量的思考区;rule 路径零
 *   思考帧);render 帧(渲染短路 LLM 路径 SSE 化)与一次性
 *   JSON 回执同形处置;final 帧更新 sessionId(localStorage 持久化,纯投影)
 *   与 render 回执;整体超时 120s 如实报错;
 * - 停止(B2):onCancel 挂 AbortController 中止 fetch,追加「已停止(仅中断
 *   展示,服务端轨迹已在事件日志留痕)」——循环在服务端跑完并落 chat-turn;
 * - 历史(B3):挂载时按 localStorage 的 sessionId 拉 /api/chat/history,
 *   各回合 messages 重放进消息列表(goal 作为 user 消息在前);「新会话」
 *   清 localStorage + 清空消息(历史仍在日志,审计不丢);
 * - 委托模式(T5 Phase B):开关打开后发送 mode:'delegated',立即回执
 *   「已派发委托 <id前8位>…(后台执行中),进度见舰队页 /delegations」。
 *
 * 消息态经 useExternalStoreRuntime 外接;共享类型/持久化键见 chat-types.ts。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useExternalStoreRuntime, type AppendMessage } from '@assistant-ui/react';

import type { ChatSessionSummary, ChatTurn } from '@/chat/history';
import { clientViewReportForLocation, type ActivePresentationView } from '@/chat/client-view';
import type { ChatRenderPayload, ChatStepActivity } from '@/chat/sse';
import { anySignal, createIdleTimeout, readChatSseStream, type ChatFinalPayload } from '@/chat/sse';

import {
  convertMessage,
  loadSessionId,
  PENDING_SESSION_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  STREAM_IDLE_TIMEOUT_MS,
  type ChatJsonResponse,
  type ChatSession,
  type ChatUiMessage,
  type DelegatedResponse,
} from './chat-types';

/** 聊天会话状态 + 运行时(sidebar 壳与 /chat 独立页共用同一逻辑)。 */
export function useChatSession(): ChatSession {
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const sessionRef = useRef('');
  // 委托模式(ref 镜像:onNew 回调零依赖 memo,发送时读 ref 防闭包过期)。
  const [delegated, setDelegated] = useState(false);
  const delegatedRef = useRef(false);
  // 最近一次渲染回执(S5:surface 引用的可点形态——点击在画布打开)。
  const [lastRender, setLastRender] = useState<ChatJsonResponse['render']>(undefined);
  const [lastFocus, setLastFocus] = useState<ChatJsonResponse['focus']>(undefined);
  const [lastPresentation, setLastPresentation] = useState<{
    canvasUrl: string;
    requestId: string;
  }>();
  const lastPresentationRef = useRef<ActivePresentationView | undefined>(undefined);
  const clientInstanceIdRef = useRef<string | undefined>(undefined);
  const focusRevisionRef = useRef(0);
  // 进行中请求的取消柄(B2:onCancel 中止 fetch;整体超时经 AbortSignal.any 合并)。
  const abortRef = useRef<AbortController | null>(null);
  // 高频 reasoning delta 先在 ref 聚合，每 50ms 至多提交一次 React state。
  const thinkingDeltaRef = useRef(
    new Map<string, { identity: { turnId: string; step: number }; text: string }>(),
  );
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

  const markSessionPending = useCallback((next: string | null) => {
    try {
      if (next === null) globalThis.localStorage?.removeItem(PENDING_SESSION_STORAGE_KEY);
      else globalThis.localStorage?.setItem(PENDING_SESSION_STORAGE_KEY, next);
    } catch {
      // 隐私模式退化为 history 中 running 状态轮询。
    }
  }, []);

  /** 拉取指定会话的历史回合并重放进消息列表(goal 作为 user 消息在前)。 */
  const restoreSession = useCallback(
    (stored: string) => {
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
            // thinking 是流内可见性而非 chat-turn 持久化内容：刷新明确只恢复
            // 用户/Assistant 消息，不推测或把旧 reasoning 挂到任一回合。
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
            let pendingLocally = false;
            try {
              pendingLocally =
                globalThis.localStorage?.getItem(PENDING_SESSION_STORAGE_KEY) === stored;
            } catch {
              // 无本地标记时只依据服务端 running 真相。
            }
            if (!running && turns.some((turn) => turn.status === 'final')) markSessionPending(null);
            if (running || (turns.length === 0 && pendingLocally)) poll = setTimeout(load, 1_000);
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
    },
    [markSessionPending],
  );

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

  const appendAssistant = useCallback(
    (content: string, rel?: string, activity?: ChatStepActivity, eventSeq?: number): void => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content,
          ...(rel !== undefined ? { rel } : {}),
          ...(activity !== undefined ? { activity } : {}),
          ...(eventSeq !== undefined ? { eventSeq } : {}),
        },
      ]);
    },
    [],
  );

  const flushThinkingDeltas = useCallback(() => {
    if (thinkingFlushRef.current !== null) clearTimeout(thinkingFlushRef.current);
    thinkingFlushRef.current = null;
    const pending = [...thinkingDeltaRef.current.entries()];
    thinkingDeltaRef.current.clear();
    if (pending.length === 0) return;
    setMessages((prev) => {
      const next = [...prev];
      for (const [, { identity, text }] of pending) {
        let found = false;
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (
            next[index]!.thinking?.turnId === identity.turnId &&
            next[index]!.thinking?.step === identity.step
          ) {
            next[index] = { ...next[index]!, content: next[index]!.content + text };
            found = true;
            break;
          }
        }
        if (!found) next.push({ role: 'assistant', content: text, thinking: identity });
      }
      return next;
    });
  }, []);

  /** thinking-delta 帧:同号先合帧，避免 token 速率直接放大为整棵 thread 重渲染。 */
  const appendThinkingDelta = useCallback(
    (turnId: string, step: number, piece: string) => {
      const key = `${turnId}:${step}`;
      const pending = thinkingDeltaRef.current.get(key);
      thinkingDeltaRef.current.set(key, {
        identity: { turnId, step },
        text: (pending?.text ?? '') + piece,
      });
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
  const appendThinking = useCallback((turnId: string, step: number, text: string) => {
    // 聚合终帧是权威全文：丢弃尚未提交的同号片段，避免先追加后替换的双渲染。
    thinkingDeltaRef.current.delete(`${turnId}:${step}`);
    setMessages((prev) => {
      for (let index = prev.length - 1; index >= 0; index -= 1) {
        if (prev[index]!.thinking?.turnId === turnId && prev[index]!.thinking?.step === step) {
          const next = [...prev];
          next[index] = { role: 'assistant', content: text, thinking: { turnId, step } };
          return next;
        }
      }
      return [...prev, { role: 'assistant', content: text, thinking: { turnId, step } }];
    });
  }, []);

  useEffect(
    () => () => {
      if (thinkingFlushRef.current !== null) clearTimeout(thinkingFlushRef.current);
    },
    [],
  );

  /** SSE 帧处置:step 逐步追加(活动语言/旧形状回退);final 更新会话/回执;error 如实进消息。 */
  const handleFinal = useCallback(
    (payload: ChatFinalPayload, stepCount: number, machineTextSteps: number) => {
      persistSession(payload.sessionId);
      markSessionPending(null);
      // 终局内容补一条 assistant 消息:零轨迹步(如起始实体不可得,与旧一次性
      // JSON 客户端兜底口径一致),或 T24 活动语言回合——活动条目只说「正在
      // 做什么」,answer/done/fail 的终局内容(answered 的回答、完成/失败
      // summary)不在步帧主呈现里,经 final.summary 落地,内容不丢。旧形状
      // 步帧(机器文本已含终局内容,如「完成: …」)不补,避免双份。
      if (
        (stepCount === 0 || machineTextSteps === 0) &&
        payload.summary !== null &&
        payload.summary !== ''
      ) {
        appendAssistant(
          payload.outcome === 'failed' ? `失败: ${payload.summary}` : payload.summary,
        );
      }
    },
    [appendAssistant, markSessionPending, persistSession],
  );

  /**
   * 渲染回执处置(render 帧与一次性 JSON 回执同形):会话持久化 + 画布入口
   * (lastRender,即达即跳/手动链接共用)+ 回执消息。auto-nav 经 setLastRender
   * 触发,两路(帧/JSON)零差别。
   */
  const handleRenderReceipt = useCallback(
    (payload: ChatRenderPayload) => {
      persistSession(payload.sessionId);
      markSessionPending(null);
      setLastFocus(undefined);
      setLastRender(payload.render);
      for (const entry of payload.messages) appendAssistant(entry.text);
    },
    [appendAssistant, markSessionPending, persistSession],
  );

  const handleFocus = useCallback((rel: string, refresh = false) => {
    setLastRender(undefined);
    if (refresh) focusRevisionRef.current += 1;
    const refreshQuery = refresh ? `&refresh=${focusRevisionRef.current}` : '';
    setLastFocus({ rel, canvasUrl: `/canvas?focus=${encodeURIComponent(rel)}${refreshQuery}` });
  }, []);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const part = message.content[0];
      if (part?.type !== 'text') throw new Error('仅支持文本目标');
      const goal = part.text.trim();
      if (goal === '') return;

      const activeSession = sessionRef.current || crypto.randomUUID();
      const turnId = crypto.randomUUID();
      clientInstanceIdRef.current ??= crypto.randomUUID();
      let clientView;
      try {
        clientView = clientViewReportForLocation(
          clientInstanceIdRef.current,
          `${window.location.pathname}${window.location.search}`,
          lastPresentationRef.current,
        );
      } catch {
        // An unreportable route makes this turn's client view unknown; Chat remains available.
      }
      persistSession(activeSession);
      markSessionPending(activeSession);

      setMessages((prev) => [...prev, { role: 'user', content: goal }]);
      setIsRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const idleTimeout = createIdleTimeout(STREAM_IDLE_TIMEOUT_MS);
      const signal = anySignal([controller.signal, idleTimeout.signal]);
      let stepCount = 0;
      // 机器文本步计数(T24 Phase B):无 activity 的旧形状步帧走 message.text
      // 回退渲染——它们已含终局内容,final.summary 不再补(避免双份)。
      let machineTextSteps = 0;
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            goal: { verb: goal },
            sessionId: activeSession,
            turnId,
            ...(clientView === undefined ? {} : { clientView }),
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
            // 新协议所有回合帧均携 turnId。旧服务端帧没有 turnId 时绑定到
            // 当前请求以保持兼容；显式属于其他回合的迟到帧直接丢弃。
            if ('turnId' in frame && frame.turnId !== turnId) return;
            if (frame.type === 'session') {
              persistSession(frame.sessionId);
            } else if (frame.type === 'heartbeat') {
              return;
            } else if (frame.type === 'focus') {
              handleFocus(frame.rel, frame.refresh === true);
            } else if (frame.type === 'thinking-delta') {
              appendThinkingDelta(turnId, frame.step, frame.text);
            } else if (frame.type === 'thinking') {
              appendThinking(turnId, frame.step, frame.text);
            } else if (frame.type === 'step') {
              flushThinkingDeltas();
              stepCount += 1;
              if (frame.activity === undefined) machineTextSteps += 1;
              // T24 Phase B:活动帧主呈现为活动语言(message.text 机器原文
              // 保留在消息数据里作机器层,thread 不再直出);旧形状回退原文。
              appendAssistant(frame.message.text, frame.rel, frame.activity, frame.eventSeq);
            } else if (frame.type === 'render') {
              if (frame.payload.turnId !== undefined && frame.payload.turnId !== turnId) return;
              // 渲染回执帧(渲染短路 LLM 路径 SSE 化):处置与 JSON 回执等价。
              handleRenderReceipt(frame.payload);
            } else if (frame.type === 'presentation') {
              if (
                (frame.payload.status === 'ready' || frame.payload.status === 'fallback') &&
                frame.payload.surfaceUrl !== undefined
              ) {
                const active = {
                  requestId: frame.payload.requestId,
                  surfaceUrl: frame.payload.surfaceUrl,
                };
                lastPresentationRef.current = active;
                setLastPresentation({
                  requestId: active.requestId,
                  canvasUrl: active.surfaceUrl,
                });
              }
            } else if (frame.type === 'final') {
              if (frame.payload.turnId !== undefined && frame.payload.turnId !== turnId) return;
              flushThinkingDeltas();
              handleFinal(frame.payload, stepCount, machineTextSteps);
            } else if (frame.type === 'error') {
              markSessionPending(null);
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
          markSessionPending(null);
          appendAssistant(
            `已派发委托 ${body.delegationId.replace(/^delegation-/, '').slice(0, 8)}…(后台执行中),进度见委托监控页 /delegations`,
          );
          return;
        }
        if (body.sessionId !== undefined) persistSession(body.sessionId);
        markSessionPending(null);
        // render 回执(S5):展示意图 → 画布入口链接(替换上一条渲染回执)。
        setLastRender(body.render ?? undefined);
        setLastFocus(body.focus ?? undefined);
        if (body.messages !== undefined && body.messages.length > 0) {
          for (const entry of body.messages) appendAssistant(entry.text);
        } else {
          markSessionPending(null);
          // 结构化错误信封 {error:{code}} 取 code 如实展示,不把对象直接插值。
          const failure =
            typeof body.error === 'string'
              ? body.error
              : (body.error?.code ?? body.summary ?? `HTTP ${response.status}`);
          appendAssistant(`失败: ${failure}`);
        }
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'AbortError') {
          // B2 停止:仅中断展示;服务端循环跑完,轨迹经 chat-turn 事件留痕。
          appendAssistant('已停止(仅中断展示,服务端轨迹已在事件日志留痕)');
        } else if (name === 'TimeoutError') {
          appendAssistant(
            '失败: 连接空闲超时(120s 未收到任何进展或心跳;服务端轨迹仍在事件日志留痕)',
          );
        } else {
          appendAssistant(`失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        idleTimeout.dispose();
        abortRef.current = null;
        setIsRunning(false);
      }
    },
    [
      appendAssistant,
      appendThinking,
      appendThinkingDelta,
      flushThinkingDeltas,
      handleFinal,
      handleFocus,
      handleRenderReceipt,
      markSessionPending,
      persistSession,
    ],
  );

  const onCancel = useCallback(async () => {
    abortRef.current?.abort();
  }, []);

  const toggleDelegated = useCallback(() => {
    const next = !delegatedRef.current;
    delegatedRef.current = next;
    setDelegated(next);
  }, []);

  // 新会话(B3):清 localStorage + 清空消息;历史仍在事件日志(审计不丢),
  // 旧会话经「历史会话」清单随时可回读。
  const startNewSession = useCallback(() => {
    abortRef.current?.abort();
    if (thinkingFlushRef.current !== null) clearTimeout(thinkingFlushRef.current);
    thinkingFlushRef.current = null;
    thinkingDeltaRef.current.clear();
    sessionRef.current = '';
    setSessionId('');
    setMessages([]);
    setLastRender(undefined);
    setLastFocus(undefined);
    setLastPresentation(undefined);
    lastPresentationRef.current = undefined;
    setView('chat');
    try {
      globalThis.localStorage?.removeItem(SESSION_STORAGE_KEY);
      globalThis.localStorage?.removeItem(PENDING_SESSION_STORAGE_KEY);
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
      if (thinkingFlushRef.current !== null) clearTimeout(thinkingFlushRef.current);
      thinkingFlushRef.current = null;
      thinkingDeltaRef.current.clear();
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
    // 思考条目原样进 thread(T24 Phase B):默认折叠的进行中指示由
    // thread.tsx 呈现,不再做全局隐藏过滤(呈现层负责折叠,数据不丢)。
    messages,
    convertMessage,
    onNew,
    onCancel,
  });

  return {
    sessionId,
    isRunning,
    delegated,
    lastRender,
    lastFocus,
    lastPresentation,
    toggleDelegated,
    startNewSession,
    runtime,
    view,
    sessions,
    openSessions,
    closeSessions,
    selectSession,
  };
}
