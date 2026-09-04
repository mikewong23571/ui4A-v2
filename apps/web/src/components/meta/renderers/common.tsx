'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ActionRunner } from '@/components/action-runner';
import { blockedForRenderer } from '@/components/actions/action-group';
import {
  createDirectActionSubmit,
  observedActionClientParams,
} from '@/components/actions/action-submit';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

import { execMetaAction } from '../meta-client';
import { MetaActivationDisclosure } from '../activation-disclosure-view';
import type { ActivationDisclosureView } from '../activation-disclosure';
import { withMetaNavigationContext, type MetaNavigationContext } from '../meta-navigation';
import { relFromMetaApiHref } from '../meta-surfaces';
import { redactMetaValue } from '../view-models/agent-definition';
import { projectGenericRelationships } from './generic/generic-relationship-projection';
import { MetaActionOutcome } from './meta-action-outcome';

export function titleForEntity(entity: SirenEntity): string {
  for (const key of ['title', 'name', 'ref', 'id', 'rel']) {
    const value = entity.properties[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return entity.class.join(' · ');
}

export function publicMetaActions(entity: SirenEntity): SirenAction[] {
  return entity.actions.filter(
    (action) => action.href === '/_meta/api/exec' && !action.name.includes('callback'),
  );
}

export function browserHrefForContractHref(
  href: string,
  navigation: MetaNavigationContext,
): string | null {
  const metaRel = relFromMetaApiHref(href);
  if (metaRel !== null) {
    return withMetaNavigationContext(`/meta/entity?rel=${encodeURIComponent(metaRel)}`, navigation);
  }
  if (!href.startsWith('/')) return null;
  const url = new URL(href, 'http://ui4a.local');
  if (url.origin !== 'http://ui4a.local' || url.pathname !== '/api/entity') return null;
  const rel = url.searchParams.get('rel');
  if (rel === null) return null;
  return withMetaNavigationContext(`/entity?rel=${encodeURIComponent(rel)}`, navigation);
}

interface MetaActionsProps {
  entity: SirenEntity;
  rel: string;
  scope?: string;
  /** Section heading; hosts place the same action surface under their own semantics (e.g. 集合动作). */
  title?: string;
  prefill?: Record<string, unknown>;
  excludeActions?: string[];
  onChanged?: () => void;
}

export function MetaActions(props: MetaActionsProps) {
  return <ScopedMetaActions key={JSON.stringify([props.scope ?? null, props.rel])} {...props} />;
}

function ScopedMetaActions({
  entity,
  rel,
  scope,
  title = '可用动作',
  prefill,
  excludeActions = [],
  onChanged,
}: MetaActionsProps) {
  const [lastOutcome, setLastOutcome] = useState<SirenEntity | null>(null);
  const [lastDisclosure, setLastDisclosure] = useState<ActivationDisclosureView | undefined>();
  const excluded = new Set(excludeActions);
  const actions = publicMetaActions(entity).filter((action) => !excluded.has(action.name));
  if (actions.length === 0 && lastOutcome === null) return null;
  const guards = new Map((entity['guard-results'] ?? []).map((guard) => [guard.action, guard]));
  return (
    <section aria-labelledby="meta-actions-heading" className="space-y-3">
      <h2 id="meta-actions-heading" className="text-lg font-semibold">
        {title}
      </h2>
      {actions.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {actions.map((action) => {
            const guard = guards.get(action.name);
            return (
              <Card key={action.name} className="min-w-0 p-4">
                <ActionRunner
                  rel={rel}
                  action={action}
                  blocked={blockedForRenderer(guard)}
                  blockReason={guard?.reason}
                  prefill={prefill}
                  submit={createDirectActionSubmit((input) => execMetaAction({ ...input, scope }), {
                    clientParams: ({ action: current }) =>
                      observedActionClientParams(current, entity.properties),
                  })}
                  onExecuted={onChanged}
                  onOutcome={(entity, result) => {
                    setLastOutcome(entity);
                    setLastDisclosure(result.ok ? result.disclosure : undefined);
                  }}
                  renderOutcome={() => null}
                />
              </Card>
            );
          })}
        </div>
      )}
      {lastOutcome !== null && <MetaActionOutcome entity={lastOutcome} />}
      <MetaActivationDisclosure disclosure={lastDisclosure} />
    </section>
  );
}

export function MetaActionsDisclosure({
  title,
  entity,
  rel,
  scope,
  onChanged,
}: {
  title: string;
  entity: SirenEntity;
  rel: string;
  scope?: string;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (publicMetaActions(entity).length === 0) return null;
  return (
    <details open={open} className="rounded-lg border bg-muted/20 p-4">
      <summary
        className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        {title}
      </summary>
      {open && (
        <div className="mt-4">
          <MetaActions entity={entity} rel={rel} scope={scope} onChanged={onChanged} />
        </div>
      )}
    </details>
  );
}

/** Canonical relationship navigation derived only from authorized Siren links. */
export function MetaRelationships({
  entity,
  navigation,
}: {
  entity: SirenEntity;
  navigation: MetaNavigationContext;
}) {
  const id = useId();
  const relationships = projectGenericRelationships(entity, navigation, browserHrefForContractHref);
  if (relationships.task.length === 0 && relationships.mechanical.length === 0) return null;
  const group = (label: string, items: typeof relationships.task) =>
    items.length === 0 ? null : (
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {items.map((relationship, index) => {
          const descriptionId = `${id}-${label}-${index}`;
          return (
            <div key={`${relationship.href}:${index}`} className="flex min-w-0 flex-col gap-1">
              <a
                href={relationship.href}
                data-nav="meta:relationship"
                aria-describedby={relationship.hasDeclaredTitle ? descriptionId : undefined}
                className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {relationship.label}
              </a>
              {relationship.hasDeclaredTitle && (
                <span id={descriptionId} className="px-1 text-xs text-muted-foreground">
                  {relationship.rawRel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  return (
    <div className="space-y-3">
      {group('任务关系', relationships.task)}
      {group('机械关系', relationships.mechanical)}
    </div>
  );
}

export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Card className="min-w-0 p-4">{children}</Card>
    </section>
  );
}

export function RawContract({ entity }: { entity: SirenEntity }) {
  const [open, setOpen] = useState(false);
  const summaryRef = useRef<HTMLElement>(null);

  function toggleFromKeyboard(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setOpen((current) => !current);
  }

  function closeFromEscape(event: KeyboardEvent<HTMLDetailsElement>): void {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    summaryRef.current?.focus();
  }

  return (
    <details open={open} className="rounded-lg border bg-muted/20 p-4" onKeyDown={closeFromEscape}>
      <summary
        ref={summaryRef}
        className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        onKeyDown={toggleFromKeyboard}
      >
        原始合同
      </summary>
      {open && (
        <pre className="mt-3 max-h-[32rem] overflow-auto rounded-md bg-background p-3 text-xs leading-5">
          {JSON.stringify(redactMetaValue(entity), null, 2)}
        </pre>
      )}
    </details>
  );
}

export function ClassBadges({ classes }: { classes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {classes.map((value) => (
        <Badge key={value} variant="outline">
          {value}
        </Badge>
      ))}
    </div>
  );
}
