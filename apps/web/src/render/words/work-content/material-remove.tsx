'use client';

import { useRef, useState } from 'react';
import type { SirenAction, SirenEntity } from '@ui4a/engine';
import { blockedForRenderer } from '../../../components/actions/action-group';
import { referenceOptions } from '../../../components/actions/reference-selection';
import { useActionSubmit } from '../../../components/actions/action-submit';
import { useEntityCache } from '../../../components/entity-cache-provider';
import { notifyThreadUpdated, relOf } from '../../../components/canvas/desk/thread-desk-shared';
import { Button } from '../../../components/ui/button';

type ReferenceOption = NonNullable<ReturnType<typeof referenceOptions>>[number];

/** A single declared edge, re-read before submitting through the host action adapter. */
export function MaterialRemove({
  entity,
  action,
  option,
}: {
  entity: SirenEntity;
  action: SirenAction;
  option: ReferenceOption;
}) {
  const cache = useEntityCache();
  const submit = useActionSubmit();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const lock = useRef(false);
  const rel = relOf(entity);
  const guard = entity['guard-results']?.find((item) => item.action === action.name);
  const blockReason = blockedForRenderer(guard) ? guard?.reason : undefined;
  async function remove() {
    if (!submit || lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      cache.invalidate(rel);
      const current = await cache.get(rel);
      const declared = current?.actions.find((item) => item.name === action.name);
      const selected =
        declared &&
        referenceOptions(declared)?.find(
          (candidate) =>
            Object.keys(candidate.params).length === Object.keys(option.params).length &&
            Object.entries(option.params).every(([key, value]) => candidate.params[key] === value),
        );
      if (!current || !declared || !selected) {
        setNotice('引用已变化，请刷新材料');
        return;
      }
      const currentGuard = current['guard-results']?.find((item) => item.action === declared.name);
      if (blockedForRenderer(currentGuard)) {
        setNotice(currentGuard?.reason ?? '当前不可执行');
        return;
      }
      const result = await submit({ rel, action: declared, params: selected.params });
      if (!result.ok) {
        setNotice(result.reason);
        return;
      }
      cache.invalidateAfterExec(rel, result.entity, result.subject);
      notifyThreadUpdated(rel);
      setNotice('已移出');
    } catch {
      setNotice('尚未取得执行结果，请刷新后核对');
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-action={action.name}
        data-testid={`work-material-remove:${String(option.params.rel)}`}
        aria-label={`移出 ${option.title}`}
        disabled={busy || !submit || blockedForRenderer(guard)}
        onClick={() => void remove()}
      >
        移出
      </Button>
      {(notice || blockReason) && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice ?? blockReason}
        </p>
      )}
    </div>
  );
}
