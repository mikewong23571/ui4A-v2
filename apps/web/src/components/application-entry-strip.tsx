'use client';
/**
 * T35 F-23/F-26:应用目录条——workstation 的"书架"层。
 * 数据从 sitemap applications 派生(标题+intent→entry surface),零每应用特判;
 * 这与 SiteNav 同属 canvas 壳级导航(舞台机械):换应用不改码,应用即数据。
 * F-26:超过 6 个默认折叠"更多应用";文案"数词+名词"一眼可读。
 */
import { useEffect, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';

interface ApplicationEntry {
  name: string;
  title: string;
  intent: string;
  entry: string;
}

const COLLAPSE_THRESHOLD = 6;

export function ApplicationEntryStrip() {
  const [applications, setApplications] = useState<ApplicationEntry[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/.well-known/ui4a.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { applications?: ApplicationEntry[] }) => {
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
    return <Skeleton data-testid="application-entry-strip" className="mb-4 h-8 w-full max-w-xl" />;
  }
  const entries = applications.filter((application) => application.name !== 'default');
  if (entries.length === 0) return null;

  const visible = expanded || entries.length <= COLLAPSE_THRESHOLD ? entries : entries.slice(0, COLLAPSE_THRESHOLD);
  const hidden = entries.length - visible.length;

  return (
    <section aria-label="应用" data-testid="application-entry-strip" className="mb-6">
      <p className="mb-1.5 text-xs text-muted-foreground">应用（{entries.length} 个）</p>
      <div className="flex flex-wrap items-center gap-2">
        {visible.map((application) => (
          <a
            key={application.name}
            href={`/canvas?focus=${encodeURIComponent(application.entry)}&scope=${encodeURIComponent(application.name)}`}
            data-nav={`local:app-entry:${application.name}`}
            title={application.intent}
            className="rounded-full border bg-card px-3 py-1 text-sm text-foreground transition-colors hover:bg-accent"
          >
            {application.title}
          </a>
        ))}
        {!expanded && hidden > 0 && (
          <button
            type="button"
            data-nav="local:app-entry-more"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            更多应用（{hidden}）
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </button>
        )}
      </div>
    </section>
  );
}
