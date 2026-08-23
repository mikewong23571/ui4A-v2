import type { Metadata } from 'next';

import { MetaDashboard } from '@/components/meta/meta-dashboard';

export const metadata: Metadata = {
  title: '定义控制台 · UI4A',
};

/** Sitemap-driven Meta entry. Product rel inventory belongs to the contract, never this page. */
export default async function MetaControlPlanePage({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string }>;
} = {}) {
  const scope = (await searchParams)?.scope;
  return <MetaDashboard requestedScope={scope} />;
}
