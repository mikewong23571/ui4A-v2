'use client';

import type { SirenEntity } from '@ui4a/engine';

import { Card } from '@/components/ui/card';

import type { MetaNavigationContext } from '../meta-navigation';
import { redactMetaValue } from '../view-models/agent-definition';
import {
  browserHrefForContractHref,
  MetaActions,
  publicMetaActions,
  titleForEntity,
} from './common';
import {
  collectionFacetHref,
  collectionFacetsOf,
  collectionFacetValue,
  collectionPageLinks,
  collectionSummaryOf,
  overviewFieldsOf,
  valueAtPresentationPath,
} from './generic-collection-contract';

function OverviewValue({ value }: { value: unknown }) {
  const safe = redactMetaValue(value);
  if (safe === null || typeof safe !== 'object') {
    return <span className="break-words">{String(safe ?? '—')}</span>;
  }
  return <span className="break-words">{JSON.stringify(safe)}</span>;
}

function MemberSummary({
  member,
  navigation,
}: {
  member: SirenEntity;
  navigation: MetaNavigationContext;
}) {
  const fields = overviewFieldsOf(member);
  const identity = fields.find((field) => field.role === 'identity');
  const declaredTitle =
    identity === undefined ? undefined : valueAtPresentationPath(member, identity.path);
  const title =
    typeof declaredTitle === 'string' && declaredTitle.length > 0
      ? declaredTitle
      : titleForEntity(member);
  const overview = fields.flatMap((field) => {
    if (field === identity) return [];
    const value = valueAtPresentationPath(member, field.path);
    return value === undefined || value === null || value === '' ? [] : [{ field, value }];
  });
  const href =
    member.href === undefined ? null : browserHrefForContractHref(member.href, navigation);
  const content = (
    <Card className="h-full min-w-0 gap-3 p-4 sm:grid sm:grid-cols-[minmax(12rem,1fr)_2fr] sm:items-start">
      <p className="font-medium text-foreground">{title}</p>
      {overview.length > 0 && (
        <dl className="grid min-w-0 gap-3 sm:grid-flow-col sm:auto-cols-fr">
          {overview.map(({ field, value }) => (
            <div key={field.path} className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">{field.title}</dt>
              <dd className="mt-1 text-sm">
                <OverviewValue value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
  return href === null ? (
    <div>{content}</div>
  ) : (
    <a
      href={href}
      data-nav="meta:collection-member"
      className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {content}
    </a>
  );
}

function CollectionFacets({
  entity,
  navigation,
}: {
  entity: SirenEntity;
  navigation: MetaNavigationContext;
}) {
  const facets = collectionFacetsOf(entity);
  const self = entity.links.find((link) => link.rel.includes('self'));
  if (facets.length === 0 || self === undefined) return null;
  return (
    <section aria-label="筛选" className="flex flex-wrap items-center gap-3">
      {facets.map((facet) => (
        <label key={facet.field} className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{facet.title}</span>
          <select
            aria-label={facet.title}
            value={collectionFacetValue(self.href, facet.field)}
            onChange={(event) => {
              const href = collectionFacetHref(
                self.href,
                facet.field,
                event.target.value,
                navigation,
              );
              if (href !== null) window.location.assign(href);
            }}
            className="rounded-md border border-border bg-card px-2 py-1 text-foreground"
          >
            <option value="">全部</option>
            {facet.values.map((option) => (
              <option key={option.value} value={option.value}>
                {option.title}
              </option>
            ))}
          </select>
        </label>
      ))}
    </section>
  );
}

export function GenericCollectionRenderer({
  entity,
  rel,
  navigation,
  onChanged,
}: {
  entity: SirenEntity;
  /** 提交目标集合 rel(集合级 actions 的 fresh-read/exec 都锚定在集合合同上)。 */
  rel: string;
  navigation: MetaNavigationContext;
  onChanged?: () => void;
}) {
  const members = entity.entities ?? [];
  const summary = collectionSummaryOf(entity);
  const pages = collectionPageLinks(entity.links, navigation);
  // D67.1 人机同门:集合实体的声明 actions 在人类主路径渲染(同一 /_meta/api/exec
  // 裁决、提交前 fresh-read);零声明动作时整个 section 不出现,零视觉噪音。
  const collectionActions = publicMetaActions(entity);
  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-label="集合结果摘要"
        className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
      >
        当前返回 {summary.returned} 项；
        {summary.total === undefined ? '匹配总数未由服务端声明' : `匹配总数 ${summary.total} 项`}
        {summary.truncated ? '；结果已截断，仅显示当前批次。' : '。'}
      </div>

      <CollectionFacets entity={entity} navigation={navigation} />

      {collectionActions.length > 0 && (
        <MetaActions
          entity={entity}
          rel={rel}
          title="集合动作"
          scope={navigation.scope}
          onChanged={onChanged}
        />
      )}

      {members.length > 0 ? (
        <section aria-labelledby="generic-members-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="generic-members-heading" className="text-lg font-semibold">
              成员
            </h2>
          </div>
          <div className="grid gap-3">
            {members.map((member, index) => (
              <MemberSummary
                key={
                  typeof member.properties.rel === 'string'
                    ? member.properties.rel
                    : `${member.class.join(':')}:${index}`
                }
                member={member}
                navigation={navigation}
              />
            ))}
          </div>
        </section>
      ) : (
        <Card className="p-6 text-sm text-muted-foreground">当前视角下没有成员。</Card>
      )}

      {pages.length > 0 && (
        <nav aria-label="集合分页" className="flex items-center gap-2">
          {pages.map((page) => (
            <a
              key={`${page.rel}:${page.href}`}
              href={page.href}
              rel={page.rel}
              data-nav="meta:collection-page"
              className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {page.title}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
