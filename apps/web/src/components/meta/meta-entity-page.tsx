'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useMetaEntity, useMetaSitemap, type MetaSitemapState } from './meta-client';
import type { MetaNavigationContext } from './meta-navigation';
import { MetaEntityRenderer } from './renderers/meta-entity-renderer';

function LoadingContract() {
  return (
    <div aria-label="正在加载合同" className="space-y-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function MetaEntityResource({
  rel,
  navigation,
  sitemap,
}: {
  rel: string;
  navigation: MetaNavigationContext;
  sitemap: NonNullable<MetaSitemapState['sitemap']>;
}) {
  const { entity, state, refresh } = useMetaEntity(rel, navigation.scope, sitemap.version);
  if (state === 'loading') return <LoadingContract />;
  if (state === 'missing') {
    return (
      <Card role="alert" className="p-6">
        <h1 className="text-xl font-semibold">合同不存在或当前视角下定位失败</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          检查链接；当前视角已保留，但不会改变权限。跨 principal 资源仍按不存在处理。
        </p>
      </Card>
    );
  }
  if (state === 'error' || entity === null) {
    return (
      <Card role="alert" className="border-destructive/40 p-6">
        <h1 className="text-xl font-semibold">读取合同失败</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          服务不可用。当前 URL 与审查现场已保留，可以刷新恢复。
        </p>
      </Card>
    );
  }
  return (
    <div data-testid="meta-content-ready">
      <MetaEntityRenderer
        rel={rel}
        entity={entity}
        navigation={navigation}
        descriptorTitle={sitemap.surfaces.find((surface) => surface.rel === rel)?.title}
        onChanged={refresh}
      />
    </div>
  );
}

export function MetaEntityPage({
  rel,
  navigation,
}: {
  rel: string;
  navigation: MetaNavigationContext;
}) {
  const { sitemap, state } = useMetaSitemap(navigation.scope);
  if (state === 'loading') return <LoadingContract />;
  if (state === 'error' || sitemap === null) {
    return (
      <Card role="alert" className="border-destructive/40 p-6">
        <h1 className="text-xl font-semibold">读取授权 Meta sitemap 失败</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          服务不可用。当前视角与 URL 已保留，可以刷新恢复。
        </p>
      </Card>
    );
  }
  return <MetaEntityResource rel={rel} navigation={navigation} sitemap={sitemap} />;
}
