'use client';
/**
 * 实体通用渲染页:/entity?rel=…(T2 Phase F,:form runner 人类路径)。
 *
 * 路由口径:rel 含 ":"(post:post-welcome / flow:article-drafting / …),
 * query 参数与合同端点 /api/entity?rel=… 同构,renderer 不做任何 rel 解析——
 * flow 别名、集合、实例一律交给引擎投影。
 * 页面壳只解包 searchParams(Next 16 客户端页官方形态);取数状态机与渲染
 * 在 EntityPageBody(组件级可测)。
 */
import { use } from 'react';

import { EntityPageBody } from '@/components/entity-page-body';

export default function EntityPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = use(searchParams);
  const rel = typeof params.rel === 'string' ? params.rel : '';
  return <EntityPageBody rel={rel} />;
}
