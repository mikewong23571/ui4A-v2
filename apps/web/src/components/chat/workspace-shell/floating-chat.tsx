'use client';
/**
 * assistant 工作台壳(T9 Phase B / B4;T56 P2.2 按 D78 重构布局宿主)。
 * 三形态,同一 ChatPanel 界面——
 * 1. 收起:右下 FAB(aria-label「展开聊天窗」,data-nav="local:chat-open");
 * 2. 覆盖悬浮(float,缺省):右下浮起卡片,不挤压主内容;窄视口自动收窄
 *    (min(24rem, 100vw−2rem)),390px 不超出屏幕;
 * 3. 并排停靠(sidebar):右侧固定宽度全高面板,经 AppShell 的 aside 槽位
 *    嵌入 body flex 行。是否并排由剩余宽度判定(assistantDockDecision,D78
 *    单点)——用户选择的停靠形态在视口不足(含 200% 缩放)时就地呈现为
 *    覆盖悬浮,只换壳、不挤窄主区;
 * 4. 独立窗口:头部「独立窗口」window.open('/chat')(app/chat/page.tsx
 *    复用同一 ChatPanel;经 localStorage sessionId + /api/chat/history
 *    与主窗口看同一份会话投影),本窗收起为 FAB。
 *
 * D78/FR4·FR7:剩余宽度判断替换「进线必停靠」——展开面板那一刻,当前页
 * 声明工作线且剩余宽度足够才自动停靠一次(dockedThread 记忆保留:本线内
 * 不再强制);切 focus、收到新状态、进线都不强制重新停靠,布局状态属当次
 * 用户选择。覆盖层交互(design §1):Escape 关闭;收起后焦点恢复到唤起 FAB。
 * 形态记忆持久化 localStorage(ui4a.chat.mode);/chat 页内不渲染本壳。
 * 会话逻辑(SSE 流式轨迹/停止/历史/委托/render 回执)全在
 * use-chat-session.ts 的 useChatSession + chat-panel.tsx 的 ChatPanel;
 * 状态挂在本壳,收起/展开/切形态/宽度降级不丢消息、不重建会话。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { MessageCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { ChatPanel } from '../chat-panel';
import { useChatSession } from '../use-chat-session';
import { assistantDockDecision, useViewportWidth } from './layout-decision';

/** 面板形态(localStorage 持久化;缺省 float——覆盖悬浮)。 */
type ChatMode = 'float' | 'sidebar';

const MODE_STORAGE_KEY = 'ui4a.chat.mode';

function loadMode(): ChatMode {
  try {
    return globalThis.localStorage?.getItem(MODE_STORAGE_KEY) === 'sidebar' ? 'sidebar' : 'float';
  } catch {
    return 'float';
  }
}

/**
 * 当前 URL 是否声明工作线(打开面板那一刻的当次判断,读 window.location
 * 而非订阅路由——「进线不强制重新停靠」,布局形态属当次用户选择)。
 */
function declaredThreadId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('thread');
  } catch {
    return null;
  }
}

export function FloatingChat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // 初始恒定 float(SSR/首帧零闪烁);展开时按持久化形态与宽度判定装壳。
  const [mode, setMode] = useState<ChatMode>('float');
  const session = useChatSession();
  const viewportWidth = useViewportWidth();
  // T35 W1 记忆保留:本线已自动停靠过,则本线内不再强制(尊重显式选择)。
  const [dockedThread, setDockedThread] = useState<string | null>(null);
  // 覆盖层交互:收起后焦点恢复到唤起元素 FAB(design §1)。
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(false);

  const switchMode = useCallback((next: ChatMode) => {
    setMode(next);
    try {
      globalThis.localStorage?.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // localStorage 不可用(隐私模式等):形态退化为内存态,无损
    }
  }, []);

  const closePanel = useCallback(() => {
    restoreFocusRef.current = true;
    setOpen(false);
  }, []);

  const openPanel = useCallback(() => {
    setMode(loadMode());
    // D78:进线自动停靠仅一次且受剩余宽度约束;窄视口/缩放保持覆盖悬浮。
    const thread = declaredThreadId();
    if (
      thread !== null &&
      dockedThread !== thread &&
      assistantDockDecision(viewportWidth) === 'side-by-side'
    ) {
      setDockedThread(thread);
      setMode('sidebar');
    }
    setOpen(true);
  }, [dockedThread, viewportWidth]);

  // Escape 关闭助手(float/sidebar 同一覆盖层交互;S3 §4 现状缺失已补)。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closePanel]);

  // 焦点恢复:FAB 随收起重挂,effect 在 DOM 提交后运行(ref 已就位)。
  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    fabRef.current?.focus();
  }, [open]);

  // 独立窗口(B4):window.open 弹出 /chat(同 sessionId 的历史投影);
  // 本窗收起为 FAB——两边均可继续,会话是同一份日志投影。
  const popout = useCallback(() => {
    window.open('/chat', 'ui4a-chat', 'width=560,height=840');
    setOpen(false);
  }, []);

  // 并排 = 用户选择的 sidebar 形态 ∧ 剩余宽度足够(D78);宽度不足就地
  // 呈现为覆盖悬浮,会话宿主不受形态切换影响。宽度足够时才提供「分栏」。
  const sideBySide = assistantDockDecision(viewportWidth) === 'side-by-side';
  const docked = open && mode === 'sidebar' && sideBySide;

  if (pathname === '/chat') return null;

  if (!open) {
    return (
      <div className="fixed right-4 bottom-4 z-50">
        <button
          type="button"
          ref={fabRef}
          aria-label="展开聊天窗"
          data-nav="local:chat-open"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90"
          onClick={openPanel}
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      </div>
    );
  }

  if (!docked) {
    return (
      <div className="fixed right-4 bottom-4 z-50 flex h-[32rem] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
        <ChatPanel
          variant="float"
          session={session}
          onClose={closePanel}
          onPopout={popout}
          onDock={sideBySide ? () => switchMode('sidebar') : undefined}
        />
      </div>
    );
  }

  return (
    <aside className="sticky top-12 flex h-[calc(100dvh-3rem)] w-96 shrink-0 flex-col border-l border-border bg-background">
      <ChatPanel
        variant="sidebar"
        session={session}
        onClose={closePanel}
        onPopout={popout}
        onFloat={() => switchMode('float')}
      />
    </aside>
  );
}
