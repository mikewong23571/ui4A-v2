import type { Metadata } from 'next';

import { MetaEntityPage } from '@/components/meta/meta-entity-page';

export const metadata: Metadata = {
  title: '合同详情 · 定义控制台 · UI4A',
};

export default async function GenericMetaEntityPage({
  searchParams,
}: {
  searchParams: Promise<{ rel?: string; scope?: string }>;
}) {
  const { rel, scope = 'publishing' } = await searchParams;
  if (rel === undefined || rel.length === 0) {
    return (
      <div role="alert">
        <h1 className="text-xl font-semibold">缺少合同 rel</h1>
        <p className="mt-2 text-sm text-muted-foreground">请从定义控制台或有效 Siren link 进入。</p>
      </div>
    );
  }
  return <MetaEntityPage rel={rel} scope={scope} />;
}
