'use client';
/**
 * BIOS meta/self 面:/meta/self → meta/self(definition-lifecycle 自身定义的
 * 状态机文本/表格视图;不做可视化,T7)。
 */
import { FlowDefinitionBody } from '@/components/meta/flow-definition-view';

export default function MetaSelfPage() {
  return <FlowDefinitionBody rel="meta/self" />;
}
