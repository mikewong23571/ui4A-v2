/**
 * sitemap 读者(自 service.ts 拆出,行为不变):业务/meta 两面均从快照活跃
 * 定义纯推导,按活跃集内容 hash 缓存(定义激活即重生成,版本号=内容 hash,
 * S2 的根基)。工厂吃 getSnapshot/activeFlowList 闭包,缓存随工厂实例存续。
 */
import {
  contentVersion,
  deriveSitemap,
  type FlowDefinition,
  type Sitemap,
  type SitemapSurface,
} from '@ui4a/engine';
import { metaCapabilityRel, metaFlowRel, type EngineSnapshot } from '@ui4a/shared';

/** meta 站点 sitemap(定义层交互拓扑:meta rel 面;跨站规则下业务面不携带)。 */
export interface MetaSitemap {
  version: string;
  site: 'meta';
  surfaces: SitemapSurface[];
}

export interface SitemapReaders {
  currentSitemap: () => Sitemap;
  currentMetaSitemap: () => MetaSitemap;
}

export function createSitemapReaders(
  getSnapshot: () => EngineSnapshot,
  activeFlowList: () => FlowDefinition[],
): SitemapReaders {
  // meta 站点 sitemap(meta rel 面;定义实体随 definitions 表动态列出,
  // capability 实体随 capabilities 表动态列出[T13 Phase C]——两面同进缓存键)。
  let metaSitemapCache: { key: string; sitemap: MetaSitemap } | undefined;
  const currentMetaSitemap = (): MetaSitemap => {
    const snapshot = getSnapshot();
    const surfaces: SitemapSurface[] = [
      { rel: 'meta/self', title: 'definition-lifecycle(引擎自举)' },
      { rel: 'meta/flows', title: '流程定义', collection: true },
      { rel: 'meta/activations', title: '激活队列', collection: true },
      { rel: 'meta/applications', title: '应用定义', collection: true },
      ...Object.values(snapshot.applications ?? {}).map((application) => ({
        rel: `meta/application:${application.name}`,
        title: application.title,
      })),
      ...Object.values(snapshot.definitions ?? {}).map((entry) => ({
        rel: metaFlowRel(entry.name),
        title: entry.definition.title ?? entry.name,
      })),
      { rel: 'meta/capabilities', title: '能力目录', collection: true },
      ...Object.values(snapshot.capabilities ?? {}).map((capability) => ({
        rel: metaCapabilityRel(capability.name),
        title: capability.title,
      })),
    ];
    const key = contentVersion(surfaces);
    if (metaSitemapCache?.key === key) return metaSitemapCache.sitemap;
    const sitemap: MetaSitemap = { version: key, site: 'meta', surfaces };
    metaSitemapCache = { key, sitemap };
    return sitemap;
  };

  // sitemap 从快照活跃定义推导,按活跃集内容 hash 缓存(定义不变同对象引用;
  // 定义激活 → 活跃集变化 → 版本号变[S2 根基]——version 本身就是内容 hash)。
  // T10:applications 分组吃 snapshot.applications(fold 落表)且进缓存键——
  // app 定义变更(无 flow 变更)同样重生成,版本号随之 bump。
  let sitemapCache: { key: string; sitemap: Sitemap } | undefined;
  const currentSitemap = (): Sitemap => {
    const flows = activeFlowList();
    const applications = getSnapshot().applications;
    const capabilities = getSnapshot().capabilities;
    const key = contentVersion({ flows, applications, capabilities });
    if (sitemapCache?.key === key) return sitemapCache.sitemap;
    const sitemap = deriveSitemap(flows, {
      extraSurfaces: [
        { rel: 'comments', title: '评论', collection: true },
        { rel: 'inbox', title: '确认收件箱', collection: true },
        { rel: 'delegations', title: '委托监控', collection: true },
        { rel: 'software-changes', title: '软件变更', collection: true, app: 'development' },
        { rel: 'writing-requests', title: '写作请求', collection: true, app: 'editorial' },
        { rel: 'agent-runs', title: 'Agent Runs', collection: true, app: 'development' },
        {
          rel: 'threads',
          title: 'Work Threads',
          collection: true,
          scope: 'principal',
          memberRelPrefix: 'thread:',
        },
      ],
      applications,
      capabilities,
    });
    sitemapCache = { key, sitemap };
    return sitemap;
  };

  return { currentSitemap, currentMetaSitemap };
}
