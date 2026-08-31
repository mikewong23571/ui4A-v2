'use client';

import Link from 'next/link';
import { useApplicationCatalog } from '@/components/applications/application-catalog';
import { ApplicationLink } from '@/components/applications/application-link';
import { CatalogError } from '@/components/applications/catalog-feedback';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocationObservation } from '@/presence/location';
import { applicationDirectoryHref } from '@/presence/navigation';

// Homepage disclosure budget only; full membership remains in the directory.
const HOME_APPLICATION_LIMIT = 9;

/** Declaration-ordered Application library. Current attention never narrows authorization. */
export function ApplicationEntryStrip() {
  const { state, retry } = useApplicationCatalog();
  const { route, observation } = useLocationObservation();

  const entries = state.status === 'ready' ? state.entries : [];

  return (
    <section aria-label="应用" data-testid="application-entry-strip" className="mb-6 min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium text-foreground">应用书架</h2>
          {state.status === 'ready' && (
            <span className="text-xs tabular-nums text-muted-foreground">{entries.length} 个</span>
          )}
        </div>
        <Link
          href={applicationDirectoryHref(route)}
          data-nav="local:application-directory"
          className="shrink-0 text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          全部应用
        </Link>
      </div>
      {state.status === 'loading' && <Skeleton aria-label="正在读取应用" className="h-11 w-full" />}
      {state.status === 'error' && <CatalogError retry={retry} />}
      {state.status === 'ready' &&
        (entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无可用应用。</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-9">
            {entries.slice(0, HOME_APPLICATION_LIMIT).map((application) => (
              <ApplicationLink
                key={application.name}
                application={application}
                route={route}
                currentScope={observation.scope}
                compact
              />
            ))}
          </div>
        ))}
    </section>
  );
}
