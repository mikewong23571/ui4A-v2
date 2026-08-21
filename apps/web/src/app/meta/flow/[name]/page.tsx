'use client';
/**
 * BIOS 定义查看面(详情):/meta/flow/<name> → meta/flow:<name> 投影的表格视图。
 * 页面壳只解包 params(Next 16 客户端页官方形态);取数与渲染在组件层。
 */
import { use } from 'react';

import { FlowDefinitionBody } from '@/components/meta/flow-definition-view';

export default function MetaFlowPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  return <FlowDefinitionBody rel={`meta/flow:${decodeURIComponent(name)}`} />;
}
