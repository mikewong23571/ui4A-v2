'use client';

import type { SirenEntity } from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

import { redactMetaValue } from '../view-models/agent-definition';
import {
  browserHrefForContractHref,
  ClassBadges,
  MetaActions,
  RawContract,
  titleForEntity,
} from './common';
import { GenericCollectionRenderer } from './generic-collection-renderer';

function DisplayValue({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') {
    return <span className="break-words">{String(value ?? '—')}</span>;
  }
  return (
    <pre className="max-h-56 overflow-auto rounded bg-muted/50 p-2 text-xs">
      {JSON.stringify(redactMetaValue(value), null, 2)}
    </pre>
  );
}

export function GenericMetaRenderer({
  entity,
  rel: requestedRel,
  scope,
  descriptorTitle,
  onChanged,
}: {
  entity: SirenEntity;
  rel?: string;
  scope?: string;
  descriptorTitle?: string;
  onChanged?: () => void;
}) {
  const rel =
    typeof entity.properties.rel === 'string' ? entity.properties.rel : (requestedRel ?? '');
  const members = entity.entities ?? [];
  const isCollection = entity.class.includes('collection');
  const relationshipLinks = isCollection
    ? entity.links.filter((link) => !link.rel.includes('next') && !link.rel.includes('prev'))
    : entity.links;
  const safeProperties = redactMetaValue(entity.properties) as Record<string, unknown>;
  return (
    <div className="space-y-6">
      <header className="space-y-3 border-b pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">通用合同视图</Badge>
          <span className="text-xs text-muted-foreground">
            未知类型也可安全阅读，不冒充特化体验
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {descriptorTitle ?? titleForEntity(entity)}
        </h1>
        <ClassBadges classes={entity.class} />
      </header>

      {isCollection ? (
        <GenericCollectionRenderer entity={entity} scope={scope} />
      ) : members.length > 0 ? (
        <section aria-labelledby="generic-members-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="generic-members-heading" className="text-lg font-semibold">
              成员
            </h2>
            <Badge variant="outline">{members.length}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {members.map((member, index) => {
              const href =
                member.href === undefined ? null : browserHrefForContractHref(member.href, scope);
              const content = (
                <Card className="h-full min-w-0 p-4">
                  <p className="font-medium">{titleForEntity(member)}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {typeof member.properties.rel === 'string'
                      ? member.properties.rel
                      : member.class.join(' · ')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {['status', 'version', 'kind', 'runtimeClass'].flatMap((key) =>
                      member.properties[key] === undefined
                        ? []
                        : [
                            <Badge key={key} variant="outline">
                              {key}: {String(member.properties[key])}
                            </Badge>,
                          ],
                    )}
                  </div>
                </Card>
              );
              return href === null ? (
                <div key={index}>{content}</div>
              ) : (
                <a
                  key={href}
                  href={href}
                  className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {content}
                </a>
              );
            })}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="generic-properties-heading">
        <h2 id="generic-properties-heading" className="mb-3 text-lg font-semibold">
          合同事实
        </h2>
        <dl className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
          {Object.entries(safeProperties).map(([key, value]) => (
            <div key={key} className="min-w-0 bg-card p-3">
              <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
              <dd className="mt-1 text-sm">
                <DisplayValue value={value} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {relationshipLinks.length > 0 && (
        <section aria-labelledby="generic-links-heading">
          <h2 id="generic-links-heading" className="mb-3 text-lg font-semibold">
            关系
          </h2>
          <div className="flex flex-wrap gap-2">
            {relationshipLinks.map((link, index) => {
              const href = browserHrefForContractHref(link.href, scope);
              return href === null ? null : (
                <a
                  key={`${link.href}:${index}`}
                  href={href}
                  className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {link.title ?? link.rel.join(' · ')}
                </a>
              );
            })}
          </div>
        </section>
      )}

      <MetaActions entity={entity} rel={rel} scope={scope} onChanged={onChanged} />
      <RawContract entity={entity} />
    </div>
  );
}
