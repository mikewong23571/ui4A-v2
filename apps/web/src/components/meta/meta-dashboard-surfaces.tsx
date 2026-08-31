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
  groupRole: CognitiveSemanticsGroupRole;
  descriptors: ReturnType<typeof projectMetaSurfaceDescriptors>;
  collections: LoadedCollections;
}) {
  const title = groupTitles[groupRole];
  const headingId = `meta-group-${groupRole}`;
  const layout = groupRole === 'definition' ? 'primary' : 'rail';
  return (
    <section
      role="region"
      aria-labelledby={headingId}
      data-layout={layout}
      className={
        layout === 'primary' ? 'lg:col-start-1 lg:row-start-1 lg:row-span-3' : 'lg:col-start-2'
      }
    >
      <h2 id={headingId} className="mb-2 text-sm font-semibold">
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
    <div className={`grid gap-2 ${descriptors.length > 1 ? 'sm:grid-cols-2' : ''}`}>
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
            className="group rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Card className="h-full gap-3 rounded-lg py-4 shadow-none transition-[border-color,background-color,box-shadow,transform] group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:bg-accent/20 group-hover:shadow-sm motion-reduce:transform-none">
              <CardHeader className="px-4">
                <CardTitle className="text-sm leading-5">{descriptor.title}</CardTitle>
                {intent === null ? null : <CardDescription>{intent}</CardDescription>}
                <CardAction
                  aria-hidden="true"
                  className="flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary"
                >
                  <ArrowUpRight className="size-3.5" />
                </CardAction>
              </CardHeader>
              <CardContent className="mt-auto space-y-2 px-4 text-sm">
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
                {typeof collection?.properties.count === 'number' && (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {String(collection.properties.count)} 项
                  </p>
                )}
              </CardContent>
            </Card>
          </a>
        );
      })}
    </div>
  );
}
