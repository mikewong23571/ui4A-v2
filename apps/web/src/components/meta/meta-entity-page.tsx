'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useMetaEntity, useMetaSitemap } from './meta-client';
import { MetaEntityRenderer } from './renderers/meta-entity-renderer';

export function MetaEntityPage({ rel, scope }: { rel: string; scope: string }) {
  const { entity, state, refresh } = useMetaEntity(rel, scope);
  const { sitemap } = useMetaSitemap(scope);
  if (state === 'loading')
    return (
      <div aria-label="正在加载合同" className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (state === 'missing')
    return (
      <Card role="alert" className="p-6">
        <h1 className="text-xl font-semibold">合同不存在或当前 Scope 不可见</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          检查链接与 Scope。跨 Scope 资源按不存在处理，不泄露身份或数量。
        </p>
      </Card>
    );
  if (state === 'error' || entity === null)
    return (
      <Card role="alert" className="border-destructive/40 p-6">
        <h1 className="text-xl font-semibold">读取合同失败</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          服务不可用。当前 URL 与审查现场已保留，可以刷新恢复。
        </p>
      </Card>
    );
  return (
    <div data-testid="meta-content-ready">
      <MetaEntityRenderer
        entity={entity}
        scope={scope}
        descriptorTitle={sitemap?.surfaces.find((surface) => surface.rel === rel)?.title}
        onChanged={refresh}
      />
    </div>
  );
}
