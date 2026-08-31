import { ArrowUpRight } from 'lucide-react';
import { applicationLandingHref } from '@/presence/navigation';
import type { ApplicationEntry } from './application-catalog';

/** One canonical landing link, with compact or descriptive presentation only. */
export function ApplicationLink({
  application,
  route,
  currentScope,
  compact = false,
}: {
  application: ApplicationEntry;
  route: string;
  currentScope: string | null;
  compact?: boolean;
}) {
  return (
    <a
      href={applicationLandingHref(route, application.name)}
      data-nav={`local:app-entry:${application.name}`}
      aria-current={currentScope === application.name ? 'page' : undefined}
      title={compact ? application.intent : undefined}
      className={`group min-w-0 rounded-lg border bg-card text-foreground transition-colors hover:border-foreground/20 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:border-foreground/30 aria-[current=page]:bg-accent ${compact ? 'flex min-h-11 items-center justify-center px-2 py-2 text-sm' : 'block h-full p-4'}`}
    >
      {compact ? (
        <span className="truncate font-medium">{application.title}</span>
      ) : (
        <>
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 font-medium wrap-anywhere">{application.title}</span>
            <ArrowUpRight
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
          </span>
          <span className="mt-2 block text-sm leading-6 text-muted-foreground wrap-anywhere">
            {application.intent}
          </span>
        </>
      )}
    </a>
  );
}
