'use client';

import { useEffect, useState } from 'react';

import { parseCognitiveSemanticsDeclaration } from '@ui4a/shared';

import { Skeleton } from '@/components/ui/skeleton';
import { useLocationObservation } from '@/presence/location';
import { applicationLandingHref } from '@/presence/navigation';

interface ApplicationSitemapEntry {
  name: string;
  title: string;
  intent: string;
  presentation?: unknown;
}

function isBusinessApplication(application: ApplicationSitemapEntry): boolean {
  try {
    const presentation = parseCognitiveSemanticsDeclaration(application.presentation);
    return presentation?.traits?.includes('system-fallback') !== true;
  } catch {
    // Public presentation is a closed contract. Malformed cognition cannot establish membership.
    return false;
  }
}

/** Declaration-ordered Application library. Current attention never narrows authorization. */
export function ApplicationEntryStrip() {
  const [applications, setApplications] = useState<ApplicationSitemapEntry[] | null>(null);
  const { route, observation } = useLocationObservation();

  useEffect(() => {
    let cancelled = false;
    fetch('/.well-known/ui4a.json')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((body: { applications?: ApplicationSitemapEntry[] }) => {
        if (!cancelled && Array.isArray(body.applications)) setApplications(body.applications);
      })
      .catch(() => {
        if (!cancelled) setApplications([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (applications === null) {
    return <Skeleton data-testid="application-entry-strip" className="mb-4 h-24 w-full" />;
  }
  const entries = applications.filter(isBusinessApplication);
  if (entries.length === 0) return null;

  return (
    <section aria-label="应用" data-testid="application-entry-strip" className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">应用书架</p>
          <p className="text-xs text-muted-foreground">选择一种能力，进入它的工作入口。</p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{entries.length} 个</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map((application) => (
          <a
            key={application.name}
            href={applicationLandingHref(route, application.name)}
            data-nav={`local:app-entry:${application.name}`}
            aria-current={observation.scope === application.name ? 'page' : undefined}
            className="group min-w-0 rounded-lg border bg-card px-3 py-2.5 text-foreground transition-colors hover:border-foreground/20 hover:bg-accent aria-[current=page]:border-foreground/30 aria-[current=page]:bg-accent"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{application.title}</span>
              <span
                aria-hidden="true"
                className="truncate font-mono text-[10px] text-muted-foreground"
              >
                {application.name}
              </span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {application.intent}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
