import type { SirenEntity } from '@ui4a/engine';
import type { CognitiveSemanticsGroupRole } from '@ui4a/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { projectMetaSurfaceDescriptors, type MetaSurfaceDescriptor } from './meta-surfaces';

const groupCopy: Record<CognitiveSemanticsGroupRole, { title: string; description: string }> = {
  responsibility: { title: '需要我决定', description: '当前需要人类判断或推进的治理责任。' },
  candidate: { title: '候选与异常', description: '等待检查、修正或接受的候选结果。' },
  definition: { title: '定义资产', description: '应用合同及其可审计的定义资产。' },
  system: { title: '系统自举', description: '系统生命周期与自举语义。' },
};

type LoadedCollections = Record<string, SirenEntity | null>;

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function displayValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

export function DashboardSurfaceGroup({
  groupRole,
  descriptors,
  collections,
}: {
  groupRole: CognitiveSemanticsGroupRole;
  descriptors: ReturnType<typeof projectMetaSurfaceDescriptors>;
  collections: LoadedCollections;
}) {
  const copy = groupCopy[groupRole];
  const headingId = `meta-group-${groupRole}`;
  return (
    <section role="region" aria-labelledby={headingId}>
      <div className="mb-3">
        <h2 id={headingId} className="text-lg font-semibold">
          {copy.title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
      </div>
      <DashboardSurfaceGrid descriptors={descriptors} collections={collections} />
    </section>
  );
}

function overviewFields(descriptor: MetaSurfaceDescriptor, collection?: SirenEntity | null) {
  return (descriptor.presentation?.fields ?? []).flatMap((field) => {
    if (
      field.overview !== true ||
      field.path === 'properties.title' ||
      field.path === 'properties.intent'
    ) {
      return [];
    }
    const value = displayValue(readPath(collection, field.path));
    return value === null ? [] : [{ path: field.path, title: field.title, value }];
  });
}

export function DashboardSurfaceGrid({
  descriptors,
  collections,
}: {
  descriptors: ReturnType<typeof projectMetaSurfaceDescriptors>;
  collections: LoadedCollections;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {descriptors.map((descriptor) => {
        const collection = collections[descriptor.rel];
        const intent = displayValue(collection?.properties.intent);
        const fields = overviewFields(descriptor, collection);
        return (
          <a
            key={descriptor.rel}
            href={descriptor.href}
            data-testid="meta-surface"
            data-priority={descriptor.presentation?.priority}
            className={`group rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${descriptor.presentation?.priority === 'high' ? 'sm:col-span-2' : ''}`}
          >
            <Card className="h-full gap-3 transition-colors group-hover:border-primary/50 group-hover:bg-accent/30">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">{descriptor.title}</CardTitle>
                  <Badge variant="secondary">{descriptor.kind === 'self' ? '系统' : '集合'}</Badge>
                </div>
                {intent === null ? null : <CardDescription>{intent}</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {fields.length > 0 && (
                  <dl className="space-y-1 text-muted-foreground">
                    {fields.map((field) => (
                      <div key={field.path} className="flex gap-2">
                        <dt>{field.title}</dt>
                        <dd className="text-foreground">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="flex items-center justify-between gap-2 text-primary">
                  <span>打开工作区 →</span>
                  {typeof collection?.properties.count === 'number' && (
                    <Badge variant="outline">{String(collection.properties.count)} 项</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </a>
        );
      })}
    </div>
  );
}
