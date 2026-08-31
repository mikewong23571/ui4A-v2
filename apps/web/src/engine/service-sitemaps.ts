/**
 * sitemap 读者(自 service.ts 拆出,行为不变):业务/meta 两面均从快照活跃
 * 定义纯推导,按活跃集内容 hash 缓存(定义激活即重生成,版本号=内容 hash,
 * S2 的根基)。工厂吃 getSnapshot/activeFlowList 闭包,缓存随工厂实例存续。
 */
import {
  contentVersion,
  deriveSitemap,
  isMemberCollectionRel,
  withMetaTopLevelPresentation,
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
      withMetaTopLevelPresentation({
        rel: 'meta/self',
        title: '引擎自举(definition-lifecycle)',
      }),
      withMetaTopLevelPresentation({ rel: 'meta/flows', title: '流程定义', collection: true }),
      withMetaTopLevelPresentation({
        rel: 'meta/activations',
        title: '激活队列',
        collection: true,
      }),
      withMetaTopLevelPresentation({
        rel: 'meta/applications',
        title: '应用定义',
        collection: true,
      }),
      ...Object.values(snapshot.applications ?? {}).map((application) => ({
        rel: `meta/application:${application.name}`,
        title: application.title,
      })),
      ...Object.values(snapshot.definitions ?? {}).map((entry) => ({
        rel: metaFlowRel(entry.name),
        title: entry.definition.title ?? entry.name,
      })),
      withMetaTopLevelPresentation({
        rel: 'meta/capabilities',
        title: '能力目录',
        collection: true,
      }),
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
    const snapshot = getSnapshot();
    const applications = snapshot.applications;
    const capabilities = snapshot.capabilities;
    // T38:`pageable` 与合同分页判定同源(isMemberCollectionRel = 成员集合表
    // 在案 ∪ append 声明);`collection` 维持集合类视图语义(threads 等平台
    // 视图仍是集合导航面但不接受查询参数)。成员表键集进缓存键(首成员出现/
    // 清空 → sitemap 重生成,标志随之翻转)。
    const flowRecord = Object.fromEntries(flows.map((flow) => [flow.name, flow]));
    const pageableFlag = (rel: string): { pageable: boolean } => ({
      pageable: isMemberCollectionRel(snapshot, flowRecord, rel),
    });
    const key = contentVersion({
      flows,
      applications,
      capabilities,
      collections: Object.keys(snapshot.collections ?? {}),
    });
    if (sitemapCache?.key === key) return sitemapCache.sitemap;
    const sitemap = deriveSitemap(flows, {
      extraSurfaces: [
        { rel: 'comments', title: '评论', collection: true, ...pageableFlag('comments') },
        {
          rel: 'inbox',
          title: '确认收件箱',
          collection: true,
          ...pageableFlag('inbox'),
          scope: 'principal',
        },
        {
          rel: 'delegations',
          title: '委托监控',
          collection: true,
          ...pageableFlag('delegations'),
          scope: 'principal',
        },
        {
          rel: 'software-changes',
          title: '软件变更',
          collection: true,
          ...pageableFlag('software-changes'),
          app: 'development',
        },
        {
          rel: 'writing-requests',
          title: '写作请求',
          collection: true,
          ...pageableFlag('writing-requests'),
          app: 'editorial',
        },
        {
          rel: 'agent-runs',
          title: 'Agent 运行',
          collection: true,
          ...pageableFlag('agent-runs'),
          app: 'development',
        },
        {
          rel: 'threads',
          title: '工作线',
          collection: true,
          ...pageableFlag('threads'),
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
