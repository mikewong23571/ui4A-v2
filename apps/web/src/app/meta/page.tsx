import type { Metadata } from 'next';

import { MetaDashboard } from '@/components/meta/meta-dashboard';

export const metadata: Metadata = {
  title: '定义控制台 · UI4A',
};

/** Sitemap-driven Meta entry. Product rel inventory belongs to the contract, never this page. */
export default async function MetaControlPlanePage({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string; query?: string; filter?: string }>;
} = {}) {
  const params = await searchParams;
  const filter =
    params?.filter === 'pending' || params?.filter === 'invalid' ? params.filter : 'all';
  return (
    <MetaDashboard
      requestedScope={params?.scope}
      initialQuery={params?.query}
      initialFilter={filter}
    />
  );
}
