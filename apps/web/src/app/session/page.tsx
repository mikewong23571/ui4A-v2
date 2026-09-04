import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SessionPanel } from '@/components/session/session-panel';

export const metadata: Metadata = { title: '我的授权 · UI4A' };

export default function SessionPage() {
  return (
    <Suspense>
      <SessionPanel />
    </Suspense>
  );
}
