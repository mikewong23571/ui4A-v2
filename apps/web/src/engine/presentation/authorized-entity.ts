import type { SirenEntity } from '@ui4a/engine';

import {
  assertReachable,
  assertThreadOwner,
  filterEntityForGrantedApplications,
  filterThreadEntityForPrincipal,
} from '../../auth/application-scope';
import { ProductionIdentityError } from '../../auth/production/request-identity';
import { getDb, getEngine } from '../service';

/**
 * D51 Phase B 失败区分(B1 taxonomy):授权读取的三态结果,供 Broker deny 分流
 * 与 sidecar 命中重审共用——audience-unreachable(授予外)与
 * subject-unavailable(不存在/加载失败/他人私有物)不再压缩成一个 undefined。
 */
export interface AuthorizedPresentationResult {
  kind: 'authorized' | 'audience-unreachable' | 'subject-unavailable';
  entity?: SirenEntity;
}

/**
 * Presentation 侧读咽喉(D51):判权输入只有凭证授予的应用集合与事实归属,
 * 不从会话冻结 scope 推导。grantedApplications 含 'local-demo'(本地信任域
 * 标记)时跳过受众过滤,仅保留 thread 属主重审;未知 rel fail-open 交既有
 * 三段裁决兜底。
 */
export async function getAuthorizedPresentationResult(
  rel: string,
  principal: string,
  grantedApplications: readonly string[],
): Promise<AuthorizedPresentationResult> {
  const engine = await getEngine(getDb());
  const snapshot = await engine.readSnapshot();
  const sitemap = engine.getSitemap();
  try {
    if (!grantedApplications.includes('local-demo')) {
      assertReachable({ snapshot, sitemap, plane: 'business' }, rel, grantedApplications);
    }
  } catch (error) {
    if (error instanceof ProductionIdentityError) return { kind: 'audience-unreachable' };
    throw error;
  }
  try {
    // 受众可达后的属主重审:跨 principal 私有物按存在性隐藏口径表达。
    assertThreadOwner(snapshot, rel, principal);
  } catch (error) {
    if (error instanceof ProductionIdentityError) return { kind: 'subject-unavailable' };
    throw error;
  }
  const entity = await engine.getEntity(rel);
  if (entity === undefined) return { kind: 'subject-unavailable' };
  const principalScoped = filterThreadEntityForPrincipal(entity, snapshot, rel, principal);
  if (grantedApplications.includes('local-demo')) {
    return { kind: 'authorized', entity: principalScoped };
  }
  return {
    kind: 'authorized',
    entity: filterEntityForGrantedApplications(principalScoped, {
      snapshot,
      sitemap,
      plane: 'business',
      grantedApplications,
      principal,
    }),
  };
}

/**
 * 机械等价包装(undefined 口径):判定失败如实返回 undefined,Broker 走
 * authorization-failed 通道表达(denied reasonCode 分流在注入点完成)。
 * Sidecar 生命周期/晋升路径复用同一布尔语义。
 */
export async function getAuthorizedPresentationEntity(
  rel: string,
  principal: string,
  grantedApplications: readonly string[],
): Promise<SirenEntity | undefined> {
  try {
    const result = await getAuthorizedPresentationResult(rel, principal, grantedApplications);
    return result.kind === 'authorized' ? result.entity : undefined;
  } catch {
    return undefined;
  }
}
