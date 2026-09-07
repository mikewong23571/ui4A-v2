'use client';

import Link from 'next/link';
import { parseCognitiveSemanticsProjection, type SirenEntity } from '@ui4a/engine';
import { useCanvasEntityHref } from '@/presence/use-canvas-entity-href';
import { ActionGroup } from '../../components/actions/action-group';
import { MemberCardWord } from './member-card';
import { declaredMemberOverview } from './member-overview';
import {
  asMembers,
  asOptionalActions,
  asOptionalFields,
  asOptionalGuardResults,
  asOptionalPresentations,
  asOptionalString,
  asRequiredString,
  type WordProps,
} from './shared';

/** Unknown future cognition falls back to the readable contract, as it does in generic planning. */
function cognition(value: unknown) {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const projection = Object.fromEntries(
    ['version', 'traits', 'groupRole', 'priority', 'emptyMeaning', 'fields'].flatMap((key) =>
      key in source ? [[key, source[key]]] : [],
    ),
  );
  try {
    return parseCognitiveSemanticsProjection(projection);
  } catch {
    return undefined;
  }
}

function responsibilities(members: readonly SirenEntity[]): SirenEntity[] {
  return members.flatMap((member) => {
    const semantics = cognition(member.properties.presentation);
    const group = semantics?.groupRole !== undefined && member.entities !== undefined;
    const own = !group && semantics?.traits?.includes('human-responsibility') ? [member] : [];
    return [...own, ...responsibilities(member.entities ?? [])];
  });
}

function ResponsibilityLinks({ members }: { members: readonly SirenEntity[] }) {
  const canvasEntityHref = useCanvasEntityHref();
  const pending = [
    ...new Map(responsibilities(members).map((member) => [member.properties.rel, member])).values(),
  ];
  return pending.length === 0 ? null : (
    <div aria-label="决定与依据" className="mt-2 flex flex-wrap gap-3">
      {pending.map((member) => (
        <Link
          key={String(member.properties.rel)}
          href={canvasEntityHref(String(member.properties.rel))}
          data-nav="presentation:responsibility"
          className="text-sm font-medium text-primary underline"
        >
          {String(member.properties.identity ?? member.properties.rel)}
        </Link>
      ))}
    </div>
  );
}

/** A compact reading row; explicit grouping never obscures an object's own responsibility. */
export function MemberRowWord(props: WordProps) {
  const canvasEntityHref = useCanvasEntityHref();
  const label = asRequiredString(props.label, 'member-row', 'label');
  const rel = asRequiredString(props.rel, 'member-row', 'rel');
  const status = asOptionalString(props.status, 'member-row', 'status');
  const detail = asOptionalString(props.detail, 'member-row', 'detail');
  const actions = asOptionalActions(props.actions, 'member-row', 'actions');
  const members =
    props.members === undefined ? undefined : asMembers(props.members, 'member-row', 'members');
  const semantics = cognition(props.cognitive);
  const group = semantics?.groupRole !== undefined && members !== undefined;
  if (!group && semantics?.traits?.includes('human-responsibility')) {
    return (
      <>
        <MemberCardWord {...props} />
        <ResponsibilityLinks members={members ?? []} />
      </>
    );
  }
  const fields = asOptionalFields(props.fields, 'member-row', 'fields');
  const overview = declaredMemberOverview(
    asOptionalPresentations(props.presentations, 'member-row', 'presentations'),
    fields,
  );
  const entity: SirenEntity = {
    class: [],
    properties: { rel, fields },
    actions,
    links: [],
    'guard-results': asOptionalGuardResults(props.guardResults, 'member-row', 'guardResults'),
  };
  return (
    <article
      data-word="member-row"
      data-rel={rel}
      className="min-w-0 border-b border-border/60 py-4 last:border-b-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link
          href={canvasEntityHref(rel)}
          data-nav="presentation:member"
          className="min-w-0 break-words text-base font-medium hover:underline"
        >
          {label}
        </Link>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
      {detail && detail !== status && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {detail}
        </p>
      )}
      {overview.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {overview.map(({ presentation, value }) => (
            <div key={presentation.path} data-column={presentation.path} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{presentation.title}</dt>
              {value !== undefined && <dd className="whitespace-pre-wrap break-words">{value}</dd>}
            </div>
          ))}
        </dl>
      )}
      <ResponsibilityLinks members={members ?? []} />
      {actions.length > 0 && (
        <div className="mt-2">
          <ActionGroup entity={entity} posture="disclosure" formHost="dialog" />
        </div>
      )}
    </article>
  );
}
