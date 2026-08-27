import type { SirenEntity } from '@ui4a/engine';

import {
  assertReachable,
  assertThreadOwner,
  filterEntityForGrantedApplications,
  filterThreadEntityForPrincipal,
} from '../../auth/application-scope';
import { getDb, getEngine } from '../service';

/**
 * Presentation 侧读咽喉(D51):判权输入只有凭证授予的应用集合与事实归属,
 * 不再从会话冻结 scope 推导。grantedApplications 含 'local-demo'(本地信任域
 * 标记)时跳过受众过滤,仅保留 thread 属主重审——旧 local-demo 分支的机械等价。
 * 判权失败如实返回 undefined,由 Broker 走既有 authorization-failed 通道表达
 * (denied reasonCode 分流属 Phase B)。
 */
export async function getAuthorizedPresentationEntity(
  rel: string,
  principal: string,
  grantedApplications: readonly string[],
): Promise<SirenEntity | undefined> {
  const engine = await getEngine(getDb());
  const snapshot = await engine.readSnapshot();
  const sitemap = engine.getSitemap();
  try {
    assertThreadOwner(snapshot, rel, principal);
    const localDomain = grantedApplications.includes('local-demo');
    if (!localDomain) {
      assertReachable({ snapshot, sitemap, plane: 'business' }, rel, grantedApplications);
    }
    const entity = await engine.getEntity(rel);
    if (entity === undefined) return undefined;
    const principalScoped = filterThreadEntityForPrincipal(entity, snapshot, rel, principal);
    if (localDomain) return principalScoped;
    return filterEntityForGrantedApplications(principalScoped, {
      snapshot,
      sitemap,
      plane: 'business',
      grantedApplications,
    });
  } catch {
    return undefined;
  }
}
