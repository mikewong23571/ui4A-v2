import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ApplicationDirectory } from '@/components/applications/application-directory';

export const metadata: Metadata = { title: '应用 · UI4A' };

export default function ApplicationsPage() {
  return (
    <Suspense>
      <ApplicationDirectory />
    </Suspense>
  );
}
