import type { Sitemap } from '@ui4a/engine';

import { filterSitemapForPolicyScope } from '../../../auth/application-scope';

// /.well-known/ui4a.json 的 scope 并集纯函数:发现文档语义 = 已授予 scope 的并集,
// 逐 scope 过滤后合并去重,消除"冻结单一 scope"对多 scope 用户的伤害(Agent 在
// sitemap 里能看到全部已授权应用的 rel)。放路由就近而非 auth/(GR3 基线 shrink-only)。

function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(item);
  }
  return result;
}

/**
 * 多 scope 并集:对已授予 scope 集合逐 scope 过滤后再合并。顺序确定:按 granted
 * 顺序逐 scope 拼接后按稳定键去重(surfaces→rel、其余→name,先到先得);单 scope
 * 时结果与 filterSitemapForPolicyScope 完全一致(版本后缀同形)。
 */
export function filterSitemapForPolicyScopes(
  sitemap: Sitemap,
  policyScopes: readonly string[],
): Sitemap {
  const scopes = [...new Set(policyScopes)];
  const parts = scopes.map((policyScope) => filterSitemapForPolicyScope(sitemap, policyScope));
  return {
    ...sitemap,
    version: `${sitemap.version}:${scopes.join('+')}`,
    surfaces: dedupeBy(
      parts.flatMap((part) => part.surfaces),
      (surface) => surface.rel,
    ),
    flows: dedupeBy(
      parts.flatMap((part) => part.flows),
      (flow) => flow.name,
    ),
    applications: dedupeBy(
      parts.flatMap((part) => part.applications),
      (application) => application.name,
    ),
    capabilities: dedupeBy(
      parts.flatMap((part) => part.capabilities),
      (capability) => capability.name,
    ),
  };
}
