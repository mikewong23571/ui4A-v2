'use client';

import { useState, type ReactNode } from 'react';

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
import { browserHrefForMetaRel, relFromMetaApiHref } from '../meta-surfaces';
import { redactMetaValue } from '../view-models/agent-definition';

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

export function browserHrefForContractHref(href: string, scope?: string): string | null {
  const metaRel = relFromMetaApiHref(href);
  if (metaRel !== null) return browserHrefForMetaRel(metaRel, scope);
  if (!href.startsWith('/')) return null;
  const url = new URL(href, 'http://ui4a.local');
  if (url.origin !== 'http://ui4a.local' || url.pathname !== '/api/entity') return null;
  const rel = url.searchParams.get('rel');
  if (rel === null) return null;
  const query = new URLSearchParams({ rel });
  if (scope !== undefined && scope.length > 0) query.set('scope', scope);
  return `/entity?${query.toString()}`;
}

export function MetaActions({
  entity,
  rel,
  scope,
  prefill,
  excludeActions = [],
  onChanged,
}: {
  entity: SirenEntity;
  rel: string;
  scope?: string;
  prefill?: Record<string, unknown>;
  excludeActions?: string[];
  onChanged?: () => void;
}) {
  const excluded = new Set(excludeActions);
  const actions = publicMetaActions(entity).filter((action) => !excluded.has(action.name));
  if (actions.length === 0) return null;
  const guards = new Map((entity['guard-results'] ?? []).map((guard) => [guard.action, guard]));
  return (
    <section aria-labelledby="meta-actions-heading" className="space-y-3">
      <h2 id="meta-actions-heading" className="text-lg font-semibold">
        可用动作
      </h2>
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
              />
            </Card>
          );
        })}
      </div>
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
export function MetaRelationships({ entity, scope }: { entity: SirenEntity; scope?: string }) {
  const relationships = entity.links.flatMap((link, index) => {
    const href = browserHrefForContractHref(link.href, scope);
    if (href === null) return [];
    return [
      <a
        key={`${link.href}:${index}`}
        href={href}
        aria-label={link.rel.join(' · ')}
        className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {link.title ?? link.rel.join(' · ')}
      </a>,
    ];
  });
  if (relationships.length === 0) return null;
  return (
    <section aria-labelledby="meta-relationships-heading">
      <h2 id="meta-relationships-heading" className="mb-3 text-lg font-semibold">
        关系
      </h2>
      <div className="flex flex-wrap gap-2">{relationships}</div>
    </section>
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
  return (
    <details
      className="rounded-lg border bg-muted/20 p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
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
