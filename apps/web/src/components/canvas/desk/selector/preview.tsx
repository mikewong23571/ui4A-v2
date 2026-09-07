'use client';
import { useEffect, useState } from 'react';
import type { SirenEntity, SirenFieldPresentation } from '@ui4a/engine';
import { useEntityCache } from '../../../entity-cache-provider';
import { Button } from '../../../ui/button';
import type { SelectorCandidate } from './discovery';

/** Preview consumes declared fields from a fresh authorized read, never embedded stale facts. */
function previewFields(entity: SirenEntity) {
  const presentation = entity.properties.presentation as
    { fields?: SirenFieldPresentation[] } | undefined;
  return (presentation?.fields ?? []).flatMap((field) => {
    if (field.role === 'identity') return [];
    let value: unknown = entity;
    for (const segment of field.path.split('.')) {
      value =
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)[segment]
          : undefined;
    }
    if (
      Array.isArray(value) &&
      value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))
    )
      value = value.join('、');
    if (!['string', 'number', 'boolean'].includes(typeof value) || value === '') return [];
    return [{ path: field.path, title: field.title, value: String(value) }];
  });
}

export function CandidatePreview({
  candidate,
  onBack,
}: {
  candidate: SelectorCandidate;
  onBack(): void;
}) {
  const cache = useEntityCache();
  const [entity, setEntity] = useState<SirenEntity | null | undefined>();
  useEffect(() => {
    let cancelled = false;
    cache.invalidate(candidate.rel);
    void cache
      .get(candidate.rel)
      .catch(() => null)
      .then((next) => {
        if (!cancelled) setEntity(next);
      });
    return () => {
      cancelled = true;
    };
  }, [cache, candidate.rel]);
  const fields = entity ? previewFields(entity) : [];
  return (
    <section aria-label="材料预览" className="min-h-40 space-y-3 py-2">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        返回列表
      </Button>
      <h3 className="break-words font-medium">{candidate.identity}</h3>
      <p className="break-all text-xs text-muted-foreground">
        {candidate.sources.join(' · ')} · {candidate.rel}
      </p>
      {entity === undefined ? (
        <p role="status">读取中…</p>
      ) : entity === null ? (
        <p role="alert">暂时无法读取</p>
      ) : fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无可预览内容</p>
      ) : (
        <dl className="space-y-3">
          {fields.map((field) => (
            <div key={field.path}>
              <dt className="text-xs text-muted-foreground">{field.title}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
