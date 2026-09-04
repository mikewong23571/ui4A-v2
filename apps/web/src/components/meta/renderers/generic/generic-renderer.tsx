'use client';

import type { SirenEntity } from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';

import { metaNavigationContext, type MetaNavigationContext } from '../meta-navigation';
import { redactMetaValue } from '../view-models/agent-definition';
import {
  browserHrefForContractHref,
  ClassBadges,
  MetaActions,
  MetaRelationships,
  RawContract,
  titleForEntity,
} from './common';
import { GenericCollectionRenderer } from './generic-collection-renderer';
import { genericDisclosureContract } from './generic-disclosure-contract';
import { GenericDeclaredDisclosure } from './generic-disclosure';

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
  navigation = {},
  descriptorTitle,
  onChanged,
}: {
  entity: SirenEntity;
  rel?: string;
  navigation?: MetaNavigationContext;
  descriptorTitle?: string;
  onChanged?: () => void;
}) {
  const parsedNavigation = metaNavigationContext(navigation);
  const rel =
    typeof entity.properties.rel === 'string' ? entity.properties.rel : (requestedRel ?? '');
  const isCollection = entity.class.includes('collection');
  const safeProperties = redactMetaValue(entity.properties) as Record<string, unknown>;
  // 集合关系不含翻页游标(next/prev 由集合渲染器自己的分页区消费)。
  const relationshipLinks = entity.links.filter(
    (link) => !link.rel.includes('next') && !link.rel.includes('prev'),
  );
  const disclosure = isCollection ? { kind: 'absent' as const } : genericDisclosureContract(entity);
  if (disclosure.kind === 'invalid') {
    return (
      <div className="space-y-6">
        <div role="alert" className="rounded-lg border border-destructive/40 p-4">
          <h1 className="text-lg font-semibold">展示语义无效</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            当前实体的声明式展示语义未通过严格校验；系统未推断任务事实，请从原始合同审计。
          </p>
        </div>
        <RawContract entity={entity} />
      </div>
    );
  }
  if (disclosure.kind === 'declared') {
    return (
      <GenericDeclaredDisclosure
        entity={entity}
        contract={disclosure}
        rel={rel}
        navigation={parsedNavigation}
        descriptorTitle={descriptorTitle}
        onChanged={onChanged}
      />
    );
  }
  if (!isCollection) {
    return (
      <div className="space-y-6">
        <header className="space-y-2 border-b pb-5">
          <Badge variant="secondary">通用合同视图</Badge>
          <h1 className="text-2xl font-semibold tracking-tight">
            {descriptorTitle ?? '未声明展示语义的实体'}
          </h1>
          <p className="text-sm text-muted-foreground">
            当前合同未声明可展示字段；动作与关系仍来自 Siren，其他事实仅在原始合同中审计。
          </p>
        </header>
        <MetaActions
          entity={entity}
          rel={rel}
          scope={parsedNavigation.scope}
          onChanged={onChanged}
        />
        <MetaRelationships entity={entity} navigation={parsedNavigation} />
        <RawContract entity={entity} />
      </div>
    );
  }
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

      {/* 集合级 actions(D67.1 人机同门)由集合渲染器在本体渲染,提交前 fresh-read。 */}
      <GenericCollectionRenderer
        entity={entity}
        rel={rel}
        navigation={parsedNavigation}
        onChanged={onChanged}
      />

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
              const href = browserHrefForContractHref(link.href, parsedNavigation);
              return href === null ? null : (
                <a
                  key={`${link.href}:${index}`}
                  href={href}
                  data-nav="meta:relationship"
                  className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {link.title ?? link.rel.join(' · ')}
                </a>
              );
            })}
          </div>
        </section>
      )}

      <RawContract entity={entity} />
    </div>
  );
}
