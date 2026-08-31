import { ArrowUpRight } from 'lucide-react';

import type { SirenEntity } from '@ui4a/engine';
import type { CognitiveSemanticsGroupRole } from '@ui4a/shared';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { projectMetaSurfaceDescriptors, type MetaSurfaceDescriptor } from './meta-surfaces';

const groupTitles: Record<CognitiveSemanticsGroupRole, string> = {
  responsibility: '需要我决定',
  candidate: '候选与异常',
  definition: '定义资产',
  system: '系统自举',
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
  groupRole?: CognitiveSemanticsGroupRole;
  descriptors: ReturnType<typeof projectMetaSurfaceDescriptors>;
  collections: LoadedCollections;
}) {
  const title = groupRole === undefined ? '治理工作区' : groupTitles[groupRole];
  const headingId = groupRole === undefined ? 'meta-surfaces-heading' : `meta-group-${groupRole}`;
  return (
    <section role="region" aria-labelledby={headingId} className="@container min-w-0 space-y-3">
      <h2 id={headingId} className="border-b pb-2 text-sm font-semibold">
        {title}
      </h2>
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
    <div className="grid grid-cols-1 gap-2 @min-[32rem]:grid-cols-2 @min-[56rem]:grid-cols-4">
      {descriptors.map((descriptor) => {
        const collection = collections[descriptor.rel];
        const intent = displayValue(collection?.properties.intent);
        const fields = overviewFields(descriptor, collection);
        return (
          <a
            key={descriptor.rel}
            href={descriptor.href}
            aria-label={`打开 ${descriptor.title}`}
            data-testid="meta-surface"
            data-priority={descriptor.presentation?.priority}
            className="group min-w-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Card className="h-full gap-2 rounded-lg py-3 shadow-none transition-[border-color,background-color,box-shadow,transform] group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:bg-accent/20 group-hover:shadow-sm motion-reduce:transform-none">
              <CardHeader className="grid-rows-[auto] items-center px-4">
                <CardTitle className="min-w-0 text-sm leading-5 wrap-anywhere">
                  {descriptor.title}
                </CardTitle>
                {intent === null ? null : (
                  <CardDescription className="min-w-0 wrap-anywhere">{intent}</CardDescription>
                )}
                <CardAction className="row-span-1 flex h-6 items-center gap-3 self-center text-muted-foreground">
                  {typeof collection?.properties.count === 'number' && (
                    <span className="text-xs whitespace-nowrap tabular-nums">
                      {String(collection.properties.count)} 项
                    </span>
                  )}
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 transition-colors group-hover:text-primary"
                  />
                </CardAction>
              </CardHeader>
              {fields.length > 0 && (
                <CardContent className="px-4 text-sm">
                  <dl className="space-y-1 text-muted-foreground">
                    {fields.map((field) => (
                      <div key={field.path} className="flex gap-2">
                        <dt>{field.title}</dt>
                        <dd className="min-w-0 text-foreground wrap-anywhere">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              )}
            </Card>
          </a>
        );
      })}
    </div>
  );
}
