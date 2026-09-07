'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/button';
import { useEntityCache } from '../../entity-cache-provider';
import { discoverCandidates, type SelectorCandidate } from './selector/discovery';
import { CandidatePreview } from './selector/preview';

export function ObjectSelectorPanel({
  attachedRels,
  busy,
  onPick,
  onClose,
  targetTitle,
  onSubmittingChange,
}: {
  attachedRels: ReadonlySet<string>;
  busy: boolean;
  onPick: (rel: string) => Promise<boolean>;
  onClose: () => void;
  targetTitle?: string;
  onSubmittingChange?: (busy: boolean) => void;
}) {
  const cache = useEntityCache();
  const [candidates, setCandidates] = useState<SelectorCandidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<SelectorCandidate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const inFlight = useRef(false);
  const disabled = busy || submitting;
  const pending = [...selected].filter((rel) => !attachedRels.has(rel) && !added.has(rel));

  useEffect(() => {
    let cancelled = false;
    void discoverCandidates(cache)
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.candidates);
        setUnavailable(result.unavailable);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cache, attempt]);

  const toggle = (rel: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  const add = async () => {
    if (disabled || inFlight.current || pending.length === 0) return;
    inFlight.current = true;
    setSubmitting(true);
    onSubmittingChange?.(true);
    setReceipt(null);
    let succeeded = 0;
    const rejected: string[] = [];
    for (const rel of pending) {
      let ok = false;
      try {
        ok = await onPick(rel);
      } catch {
        /* The failed selection remains available for retry. */
      }
      if (ok) {
        succeeded += 1;
        setAdded((current) => new Set([...current, rel]));
        setSelected((current) => {
          const next = new Set(current);
          next.delete(rel);
          return next;
        });
      } else rejected.push(rel);
    }
    setReceipt(
      rejected.length > 0
        ? `已添加 ${succeeded} 项；${rejected.length} 项未确认`
        : `已添加 ${succeeded} 项`,
    );
    setSubmitting(false);
    onSubmittingChange?.(false);
    inFlight.current = false;
  };
  const needle = filter.trim().toLowerCase();
  const titleCounts = new Map<string, number>();
  for (const candidate of candidates ?? [])
    titleCounts.set(candidate.identity, (titleCounts.get(candidate.identity) ?? 0) + 1);
  const visible = (candidates ?? []).filter((candidate) =>
    [candidate.identity, candidate.rel, ...candidate.sources].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
  return (
    <div
      data-testid="desk-selector"
      role="group"
      aria-label="选择材料"
      className="min-w-0 space-y-3"
    >
      {targetTitle && <p className="break-words text-sm text-muted-foreground">{targetTitle}</p>}
      {preview ? (
        <div className="max-h-[50dvh] overflow-y-auto">
          <CandidatePreview key={preview.rel} candidate={preview} onBack={() => setPreview(null)} />
        </div>
      ) : (
        <>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="搜索材料"
            aria-label="搜索材料"
            data-testid="desk-selector-filter"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          {candidates === null && !failed && (
            <p role="status" className="text-sm text-muted-foreground">
              读取中…
            </p>
          )}
          {(failed || unavailable) && (
            <p role="status" className="text-sm text-muted-foreground">
              {failed ? '暂时无法列出材料' : '部分清单无法读取'}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setFailed(false);
                  setUnavailable(false);
                  setAttempt((value) => value + 1);
                }}
              >
                重试
              </button>
            </p>
          )}
          {candidates !== null && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">没有匹配的材料</p>
          )}
          <ul className="max-h-[46dvh] divide-y overflow-y-auto">
            {visible.map((candidate) => {
              const attached = attachedRels.has(candidate.rel) || added.has(candidate.rel);
              return (
                <li key={candidate.rel} className="flex items-start gap-3 py-3">
                  <input
                    type="checkbox"
                    data-testid={`desk-selector-pick:${candidate.rel}`}
                    aria-label={`选择 ${candidate.identity} (${candidate.rel})`}
                    checked={!attached && selected.has(candidate.rel)}
                    disabled={disabled || attached}
                    onChange={() => toggle(candidate.rel)}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      data-testid={`desk-selector-preview:${candidate.rel}`}
                      onClick={() => setPreview(candidate)}
                      className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                    >
                      {candidate.identity}
                    </button>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {candidate.sources.join(' · ')}
                    </p>
                    <p className="break-all text-[11px] text-muted-foreground">{candidate.rel}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {attached
                      ? '已添加'
                      : candidate.status !== candidate.identity
                        ? candidate.status
                        : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {receipt && (
        <p role="status" className="text-sm">
          {receipt}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClose}>
          关闭
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="desk-selector-add"
          disabled={disabled || pending.length === 0}
          onClick={() => void add()}
        >
          {submitting ? '添加中…' : `添加 ${pending.length} 项`}
        </Button>
      </div>
    </div>
  );
}
