'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { SirenEntity } from '@ui4a/engine';
import { useCanvasEntityHref } from '@/presence/use-canvas-entity-href';
import { useEntityCache } from '../../../components/entity-cache-provider';
import { ActionGroup } from '../../../components/actions/action-group';
import { identityOf, relOf, statusOf } from '../../../components/canvas/desk/thread-desk-shared';
import { Button } from '../../../components/ui/button';
import { MemberCardWord } from '../member-card';
import { declaredContent } from './work-content-data';

function useWorkSource(member: SirenEntity) {
  const cache = useEntityCache();
  const rel = relOf(member);
  const revision = JSON.stringify(member);
  const [generation, setGeneration] = useState(0);
  const [read, setRead] = useState<{
    rel: string;
    revision: string;
    generation: number;
    entity: SirenEntity | null;
  }>();
  useEffect(() => {
    let cancelled = false;
    cache.invalidate(rel);
    void cache
      .get(rel)
      .catch(() => null)
      .then((entity) => {
        if (!cancelled)
          setRead({
            rel,
            revision,
            generation,
            entity: entity?.properties.rel === rel ? entity : null,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [cache, rel, revision, generation]);
  return {
    entity:
      read?.rel === rel && read.revision === revision && read.generation === generation
        ? read.entity
        : undefined,
    retry: () => setGeneration((value) => value + 1),
  };
}

function DeclaredContent({ entity }: { entity: SirenEntity }) {
  return (
    <dl className="space-y-5">
      {declaredContent(entity).map((field) => (
        <div key={field.path} data-column={field.path}>
          <dt className="mb-1 text-xs text-muted-foreground">{field.title}</dt>
          <dd className="min-w-0 break-words text-sm leading-7">
            {typeof field.value === 'string' && field.contentMediaType === 'text/markdown' ? (
              <div className="space-y-3 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => <h3>{children}</h3>,
                    h2: ({ children }) => <h4>{children}</h4>,
                  }}
                >
                  {field.value}
                </ReactMarkdown>
              </div>
            ) : typeof field.value === 'object' ? (
              <pre className="whitespace-pre-wrap break-words font-sans">
                {JSON.stringify(field.value, null, 2)}
              </pre>
            ) : (
              <span className="whitespace-pre-wrap">{String(field.value)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Full facts are read from the canonical source; members provide identity while it loads. */
export function WorkMember({
  member,
  responsibility = false,
  readOnly = false,
}: {
  member: SirenEntity;
  responsibility?: boolean;
  readOnly?: boolean;
}) {
  const { entity, retry } = useWorkSource(member);
  const href = useCanvasEntityHref();
  const current = entity ?? member;
  const rel = relOf(member);
  const status = statusOf(current);
  return (
    <article
      data-work-member={rel}
      data-rel={rel}
      className="min-w-0 space-y-4 border-b border-border/60 py-5 last:border-b-0"
    >
      {responsibility ? (
        <MemberCardWord
          label={identityOf(current)}
          rel={rel}
          status={status}
          actions={entity?.actions ?? []}
          guardResults={entity?.['guard-results']}
          fields={entity?.properties.fields}
          presentations={[]}
        />
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Link
            href={href(rel)}
            data-nav="presentation:work-member"
            className="text-base font-medium hover:underline"
          >
            {identityOf(current)}
          </Link>
          {status && <span className="text-xs text-muted-foreground">{status}</span>}
        </div>
      )}
      {entity === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          读取中…
        </p>
      ) : entity === null ? (
        <div className="flex items-center gap-3">
          <p role="alert" className="text-sm text-muted-foreground">
            暂时无法读取
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={retry}>
            重试
          </Button>
        </div>
      ) : (
        <>
          <DeclaredContent entity={entity} />
          {!readOnly && !responsibility && entity.actions.length > 0 && (
            <ActionGroup entity={entity} formHost="dialog" density="compact" onExecuted={retry} />
          )}
        </>
      )}
    </article>
  );
}
