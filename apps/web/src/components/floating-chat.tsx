'use client';
/**
 * 悬浮聊天窗(arch-brief §8 / spec FR7):跨页面悬浮于右下角,点击展开会话;
 * 输入目标 → POST /api/chat → agent 轨迹逐步呈现(导航/执行/被拒原因/完成)。
 *
 * 技术栈:@assistant-ui/react + useExternalStoreRuntime(消息态由本组件持有,
 * 聊天=事件日志的投影;服务端无会话态)。UI 用 Thread/Composer/Message 原语
 * + 本站 tailwind 极简样式(shadcn 风格,刻意不引完整 shadcn 主题)。
 * sessionId 持久化到 localStorage(纯投影,清掉无损);driver 缺省 auto
 * (无 key 自动回退 rule,I1)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';

interface ChatUiMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  sessionId: string;
  driver: 'rule' | 'llm';
  outcome: 'done' | 'failed' | 'max-steps';
  summary: string | null;
  messages: { role: 'assistant'; text: string }[];
}

const SESSION_STORAGE_KEY = 'ui4a.chat.sessionId';

function loadSessionId(): string {
  try {
    return globalThis.localStorage?.getItem(SESSION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function convertMessage(message: ChatUiMessage): ThreadMessageLike {
  return { role: message.role, content: [{ type: 'text', text: message.content }] };
}

// ---- 消息渲染(原语 + 本站样式)----------------------------------------------

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-3 py-1.5 text-sm text-white">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full justify-start">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-1.5 text-sm text-zinc-800">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function MyThread() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col">
      <ThreadPrimitive.Viewport className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <ThreadPrimitive.Empty>
          <p className="py-8 text-center text-xs text-zinc-400">
            输入目标委托 agent(走 HTTP 合同),如「发布一篇文章」。
          </p>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="flex items-center gap-2 border-t border-zinc-200 p-2">
        <ComposerPrimitive.Input
          rows={1}
          placeholder="输入目标…"
          className="max-h-24 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
            发送
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel className="rounded-lg bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-300">
            停止
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}

// ---- 悬浮窗壳 ----------------------------------------------------------------

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const sessionRef = useRef('');

  useEffect(() => {
    const stored = loadSessionId();
    sessionRef.current = stored;
    setSessionId(stored);
  }, []);

  const onNew = useCallback(async (message: AppendMessage) => {
    const part = message.content[0];
    if (part?.type !== 'text') throw new Error('仅支持文本目标');
    const goal = part.text.trim();
    if (goal === '') return;

    setMessages((prev) => [...prev, { role: 'user', content: goal }]);
    setIsRunning(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: { verb: goal },
          ...(sessionRef.current !== '' ? { sessionId: sessionRef.current } : {}),
        }),
      });
      const body = (await response.json()) as ChatResponse & { error?: string };
      if (body.sessionId !== undefined && body.sessionId !== sessionRef.current) {
        sessionRef.current = body.sessionId;
        setSessionId(body.sessionId);
        try {
          globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, body.sessionId);
        } catch {
          // localStorage 不可用(隐私模式等):会话退化为内存态,无损
        }
      }
      const trail =
        body.messages !== undefined && body.messages.length > 0
          ? body.messages.map((entry) => entry.text).join('\n')
          : `失败: ${body.error ?? body.summary ?? `HTTP ${response.status}`}`;
      setMessages((prev) => [...prev, { role: 'assistant', content: trail }]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `失败: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  }, []);

  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    convertMessage,
    onNew,
  });

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open ? (
        <div className="flex h-[28rem] w-[22rem] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
            <div className="text-sm font-semibold text-zinc-800">
              UI4A 助手
              <span className="ml-2 text-[10px] font-normal text-zinc-400">
                {sessionId === '' ? '新会话' : `会话 ${sessionId.slice(0, 8)}`}
              </span>
            </div>
            <button
              type="button"
              aria-label="收起聊天窗"
              className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
              onClick={() => setOpen(false)}
            >
              收起
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <AssistantRuntimeProvider runtime={runtime}>
              <MyThread />
            </AssistantRuntimeProvider>
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label="展开聊天窗"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-xl text-white shadow-lg hover:bg-blue-700"
          onClick={() => setOpen(true)}
        >
          💬
        </button>
      )}
    </div>
  );
}
