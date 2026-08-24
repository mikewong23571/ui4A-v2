import type { Metadata } from 'next';

import { AppShell } from '@/components/app-shell';
import { FloatingChat } from '@/components/floating-chat';

import './globals.css';

export const metadata: Metadata = {
  title: 'UI4A',
  description: 'UI4A — 界面作为合同',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {/* aside 槽:assistant 工作台 sidebar(T9 Phase B);收起态为右下 FAB */}
        <AppShell aside={<FloatingChat />}>{children}</AppShell>
      </body>
    </html>
  );
}
