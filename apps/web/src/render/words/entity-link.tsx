import { ArrowUpRight } from 'lucide-react';

import { canvasEntityHref } from '@/presence/navigation';

import { asRequiredString, type WordProps } from './shared';

/** Generic collection-member navigation; it is a contract link, not a business action. */
export function EntityLinkWord(props: WordProps) {
  const label = asRequiredString(props.label, 'entity-link', 'label');
  const rel = asRequiredString(props.rel, 'entity-link', 'rel');
  return (
    <a
      data-word="entity-link"
      data-nav="presentation:member"
      href={canvasEntityHref(rel)}
      className="group flex min-h-11 items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <span>{label}</span>
      <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
    </a>
  );
}
