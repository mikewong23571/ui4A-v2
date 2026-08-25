'use client';
/**
 * assistant 工作台壳(T9 Phase B / B4):三形态,同一 ChatPanel 界面——
 * 1. 收起:右下 FAB(aria-label「展开聊天窗」,data-nav="local:chat-open");
 * 2. 悬浮窗(默认展开态):右下浮起卡片(经典客服形态,fixed 定位,
 *    不挤压主内容);头部「分栏」可切换到 sidebar;
 * 3. sidebar:右侧固定宽度全高面板,与主内容左右分栏——经 AppShell 的
 *    aside 槽位嵌入 body flex 行(主区 flex-1 让宽,<main> 唯一性由
 *    AppShell 保持);头部「悬浮」可切回悬浮窗;
 * 4. 独立窗口:头部「独立窗口」window.open('/chat')(app/chat/page.tsx
 *    复用同一 ChatPanel;经 localStorage sessionId + /api/chat/history
 *    与主窗口看同一份会话投影),本窗收起为 FAB。
 *
 * 悬浮/分栏的形态选择持久化到 localStorage(ui4a.chat.mode),重开记住上次。
 * /chat 页内不渲染本壳(该页即工作台本体,避免窗中窗)。
 * 会话逻辑(SSE 流式轨迹/停止/历史/委托/render 回执)全在
 * use-chat-session.ts 的 useChatSession + chat-panel.tsx 的 ChatPanel;
 * 状态挂在壳上,收起/展开/切形态不丢消息。
 */
import { useCallback, useState } from 'react';

import { MessageCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { ChatPanel } from './chat-panel';
import { useChatSession } from './use-chat-session';

/** 面板形态(localStorage 持久化;缺省 float——经典客服悬浮窗)。 */
type ChatMode = 'float' | 'sidebar';

const MODE_STORAGE_KEY = 'ui4a.chat.mode';

function loadMode(): ChatMode {
  try {
    return globalThis.localStorage?.getItem(MODE_STORAGE_KEY) === 'sidebar' ? 'sidebar' : 'float';
  } catch {
    return 'float';
  }
}

export function FloatingChat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // 初始恒定 float(SSR/首帧零闪烁);首次展开时读持久化形态(loadMode 惰性)。
  const [mode, setMode] = useState<ChatMode>('float');
  const session = useChatSession();

  const switchMode = useCallback((next: ChatMode) => {
    setMode(next);
    try {
      globalThis.localStorage?.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // localStorage 不可用(隐私模式等):形态退化为内存态,无损
    }
  }, []);

  const openPanel = useCallback(() => {
    setMode(loadMode());
    setOpen(true);
  }, []);

  // 独立窗口(B4):window.open 弹出 /chat(同 sessionId 的历史投影);
  // 本窗收起为 FAB——两边均可继续,会话是同一份日志投影。
  const popout = useCallback(() => {
    window.open('/chat', 'ui4a-chat', 'width=560,height=840');
    setOpen(false);
  }, []);

  if (pathname === '/chat') return null;

  if (!open) {
    return (
      <div className="fixed right-4 bottom-4 z-50">
        <button
          type="button"
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

  if (mode === 'float') {
    return (
      <div className="fixed right-4 bottom-4 z-50 flex h-[32rem] w-96 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
        <ChatPanel
          variant="float"
          session={session}
          onClose={() => setOpen(false)}
          onPopout={popout}
          onDock={() => switchMode('sidebar')}
        />
      </div>
    );
  }

  return (
    <aside className="sticky top-12 flex h-[calc(100vh-3rem)] w-96 shrink-0 flex-col border-l border-border bg-background">
      <ChatPanel
        variant="sidebar"
        session={session}
        onClose={() => setOpen(false)}
        onPopout={popout}
        onFloat={() => switchMode('float')}
      />
    </aside>
  );
}
