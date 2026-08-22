'use client';
/**
 * BIOS 能力查看面(详情;T13 Phase C):/meta/capability/<name> →
 * meta/capability:<name> 投影的属性表。页面壳只解包 params(Next 16 客户端页
 * 官方形态);取数与渲染在组件层。
 */
import { use } from 'react';

import { CapabilityDefinitionBody } from '@/components/meta/capability-definition-view';

export default function MetaCapabilityPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  return <CapabilityDefinitionBody rel={`meta/capability:${decodeURIComponent(name)}`} />;
}
