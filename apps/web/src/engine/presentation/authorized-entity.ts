import type { SirenEntity } from '@ui4a/engine';

import {
  assertThreadOwner,
  filterEntityForPolicyScope,
  filterThreadEntityForPrincipal,
  relCoveredByPolicyScope,
} from '../../auth/application-scope';
import { selectCoveringPolicyScope } from '../situation';
import { getDb, getEngine } from '../service';

/**
 * Read one fresh credential lens from the current engine snapshot and sitemap.
 * grantedPolicyScopes 非空时按目标 rel 在已授予集合内选第一个覆盖 scope(目标的
 * rel 在 HTTP 入口身份解析后才出现,无法在该处冻结单一 scope);无覆盖者返回
 * undefined,与授权失败同语义。未传/空数组时维持单一 policyScope 行为。
 */
export async function getAuthorizedPresentationEntity(
  rel: string,
  principal: string,
  policyScope: string,
  grantedPolicyScopes?: readonly string[],
): Promise<SirenEntity | undefined> {
  const engine = await getEngine(getDb());
  const snapshot = await engine.readSnapshot();
  const sitemap = engine.getSitemap();
  try {
    assertThreadOwner(snapshot, rel, principal);
    const effectiveScope =
      grantedPolicyScopes !== undefined && grantedPolicyScopes.length > 0
        ? selectCoveringPolicyScope(
            { snapshot, sitemap, plane: 'business' },
            rel,
            grantedPolicyScopes,
          )
        : policyScope;
    if (effectiveScope === undefined) return undefined;
    if (
      effectiveScope !== 'local-demo' &&
      !relCoveredByPolicyScope({ snapshot, sitemap, plane: 'business' }, rel, effectiveScope)
    ) {
      return undefined;
    }
    const entity = await engine.getEntity(rel);
    if (entity === undefined) return undefined;
    const principalScoped = filterThreadEntityForPrincipal(entity, snapshot, rel, principal);
    if (effectiveScope === 'local-demo') return principalScoped;
    return filterEntityForPolicyScope(principalScoped, {
      snapshot,
      sitemap,
      policyScope: effectiveScope,
      plane: 'business',
    });
  } catch {
    return undefined;
  }
}
