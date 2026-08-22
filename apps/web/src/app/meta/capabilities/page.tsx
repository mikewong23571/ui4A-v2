'use client';
/**
 * BIOS 能力查看面(列表;T13 Phase C):meta/capabilities
 * (浏览器路由 /meta/capabilities;数据 /_meta/api)。
 */
import { CapabilitiesListBody } from '@/components/meta/meta-lists';

export default function MetaCapabilitiesPage() {
  return <CapabilitiesListBody />;
}
