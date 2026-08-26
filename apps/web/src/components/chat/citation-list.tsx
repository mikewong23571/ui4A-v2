'use client';

import { useMemo } from 'react';

import Link from 'next/link';

import { citationsOrEmpty } from '@/chat/citations';
import { useLocationObservation } from '@/presence/location';
import { citationCanvasHref } from '@/presence/navigation';

/** Tail evidence links for one assistant answer; values are never derived from answer text. */
export function CitationList({ citations: input }: { citations: unknown }) {
  const citations = useMemo(() => citationsOrEmpty(input), [input]);
  if (citations.length === 0) return null;
  return <CitationLinks citations={citations} />;
}

function CitationLinks({ citations }: { citations: ReturnType<typeof citationsOrEmpty> }) {
  const { route, observation } = useLocationObservation();

  return (
    <footer aria-label="回答依据" className="mt-2 border-t border-border/60 pt-2">
      <span className="text-[10px] font-medium text-muted-foreground">依据</span>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {citations.map((citation) => {
          const active =
            typeof observation.focus === 'string' && observation.focus === citation.rel;
          return (
            <li key={`${citation.rel}\u0000${citation.pointer}`}>
              <Link
                href={citationCanvasHref(route, citation.rel)}
                data-nav={`citation:${citation.rel}`}
                data-rel={citation.rel}
                data-pointer={citation.pointer}
                aria-current={active ? 'location' : undefined}
                className="inline-flex max-w-full flex-col rounded-md border bg-background px-2 py-1 text-left text-[10px] leading-tight text-foreground transition-colors hover:border-primary/50 aria-[current=location]:border-primary aria-[current=location]:ring-1 aria-[current=location]:ring-ring/30"
              >
                <span className="font-medium">{citation.rel}</span>
                <span className="max-w-64 truncate font-mono text-muted-foreground">
                  {citation.pointer}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </footer>
  );
}
