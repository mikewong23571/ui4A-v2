import type { SirenEntity } from '@ui4a/engine';

import {
  assertThreadOwner,
  filterEntityForPolicyScope,
  filterThreadEntityForPrincipal,
  relCoveredByPolicyScope,
} from '../../auth/application-scope';
import { getDb, getEngine } from '../service';

/** Read one fresh credential lens from the current engine snapshot and sitemap. */
export async function getAuthorizedPresentationEntity(
  rel: string,
  principal: string,
  policyScope: string,
): Promise<SirenEntity | undefined> {
  const engine = await getEngine(getDb());
  const snapshot = await engine.readSnapshot();
  const sitemap = engine.getSitemap();
  const scopeContext = { snapshot, sitemap, policyScope, plane: 'business' as const };
  try {
    assertThreadOwner(snapshot, rel, principal);
    if (
      policyScope !== 'local-demo' &&
      !relCoveredByPolicyScope({ snapshot, sitemap, plane: 'business' }, rel, policyScope)
    ) {
      return undefined;
    }
    const entity = await engine.getEntity(rel);
    if (entity === undefined) return undefined;
    const principalScoped = filterThreadEntityForPrincipal(entity, snapshot, rel, principal);
    return policyScope === 'local-demo'
      ? principalScoped
      : filterEntityForPolicyScope(principalScoped, scopeContext);
  } catch {
    return undefined;
  }
}
