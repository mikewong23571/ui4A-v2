'use client';
/**
 * assistant 工作台独立窗口(T9 Phase B / B4):sidebar 头部「独立窗口」
 * window.open('/chat') 的落点。复用同一 ChatPanel(window 态,全屏布局);
 * sessionId 从 localStorage 读,历史经 /api/chat/history 投影——与主窗口
 * 的 sidebar 看同一份会话(服务端零会话态,日志是真相)。
 *
 * 本页内悬浮聊天壳(FloatingChat)自行隐藏(pathname === '/chat' 返回 null,
 * 避免窗中窗);<main> 仍由 AppShell 提供且唯一。
 */
import { ChatPanel, useChatSession } from '@/components/chat-panel';

export default function ChatPage() {
  const session = useChatSession();
  // 高 = 视口 - 顶栏(3rem)- main 上下 padding(py-8 = 4rem);全屏工作台。
  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col">
      <ChatPanel variant="window" session={session} />
    </div>
  );
}
