'use client';
/**
 * assistant 工作台面板壳(T23 Phase D 自 chat-panel.tsx 拆出):头部(新会话/
 * 历史会话/形态切换/独立窗口/收起)+ 消息区/会话清单 + render 回执入口。
 * 会话逻辑(SSE 流式轨迹/停止/历史/委托)在 use-chat-session.ts 的
 * useChatSession;三形态壳在 floating-chat.tsx。
 *
 * - render 回执(S5):回执即达即跳——router.push 客户端导航到画布 URL
 *   (与点击链接同路:main 内容区切换,面板不重挂载;已在目标地址则跳过);
 *   底部保留「在画布查看:<concern>」链接(data-nav="render:<concern>",
 *   手动回入口,不在画布时主窗口导航过去,sidebar 与画布同屏即协同);
 *
 * UI:assistant-ui 官方 stock thread 裁剪版(@/components/assistant-ui/thread)
 * + shadcn Button;消息态经 useExternalStoreRuntime 外接。
 */
import { useEffect } from 'react';

import { AssistantRuntimeProvider } from '@assistant-ui/react';

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

import type { ChatSession } from './chat-types';
import { SessionList } from './session-list';

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
    // T40 F-11:window 态(/chat 独立页)会话即页面,focus 帧不得把整页
    // 拽去画布(导航即销毁会话上下文);画布入口由底部「当前查看」链接承担。
    // float/sidebar 态保持跟随跳转(背景画布/实体页当场反映动作后果)。
    if (variant === 'window') return;
    if (lastFocus === undefined) return;
    if (`${window.location.pathname}${window.location.search}` === lastFocus.canvasUrl) return;
    router.push(lastFocus.canvasUrl);
  }, [lastFocus, router, variant]);
  const lastPresentation = session.lastPresentation;
  useEffect(() => {
    if (lastPresentation === undefined) return;
    if (`${window.location.pathname}${window.location.search}` === lastPresentation.canvasUrl) {
      return;
    }
    router.push(lastPresentation.canvasUrl);
  }, [lastPresentation, router]);

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
            <ChatThread delegated={session.delegated} onToggleDelegated={session.toggleDelegated} />
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
