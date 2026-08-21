import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { AppShell } from '@/components/app-shell';
import { FloatingChat } from '@/components/floating-chat';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'UI4A',
  description: 'UI4A — 界面作为合同',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* aside 槽:assistant 工作台 sidebar(T9 Phase B);收起态为右下 FAB */}
        <AppShell aside={<FloatingChat />}>{children}</AppShell>
      </body>
    </html>
  );
}
