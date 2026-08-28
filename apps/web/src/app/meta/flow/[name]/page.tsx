import type { Metadata } from 'next';

import { FlowDefinitionBody } from '@/components/meta/flow-definition-view';

export const metadata: Metadata = {
  title: '流程定义 · 定义控制台 · UI4A',
};

/** BIOS 定义查看面(详情):/meta/flow/<name> → meta/flow:<name> 投影的表格视图。
 * scope 经 URL 保留(D51 跨面链接口径;缺省与合同详情页同)。 */
export default async function MetaFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { name } = await params;
  const { scope } = await searchParams;
  return <FlowDefinitionBody rel={`meta/flow:${decodeURIComponent(name)}`} scope={scope} />;
}
