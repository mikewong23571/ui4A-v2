'use client';

import { Minus } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { SirenAction, SirenEntity } from '@ui4a/engine';
import { notifyThreadUpdated } from '../canvas/desk/thread-desk-shared';
import { useEntityCache } from '../entity-cache-provider';
import { Button } from '../ui/button';
import type { ActionSubmit } from './action-submit';

interface ReferenceOption {
  title: string;
  params: Record<string, unknown>;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Presentation annotation, never inferred from an action name, application or entity rel. */
export function referenceOptions(action: SirenAction): ReferenceOption[] | undefined {
  if (action['requires-confirmation'] === 'high') return undefined;
  const declaration = action.fields['x-ui4a-reference-selection'];
  if (
    !record(declaration) ||
    declaration.effect !== 'unlink' ||
    !Array.isArray(declaration.options)
  )
    return undefined;
  return declaration.options.filter(
    (option): option is ReferenceOption =>
      record(option) && typeof option.title === 'string' && record(option.params),
  );
}

function matchingOption(options: ReferenceOption[], params: Record<string, unknown>) {
  return options.find(
    (option) =>
      Object.keys(option.params).length === Object.keys(params).length &&
      Object.entries(params).every(([name, value]) => option.params[name] === value),
  );
}

export function ReferenceSelection({
  rel,
  action,
  submit,
  onExecuted,
  blocked,
  blockReason,
}: {
  rel: string;
  action: SirenAction;
  submit: ActionSubmit;
  onExecuted?: (rel: string) => void;
  blocked: boolean;
  blockReason?: string;
}) {
  const cache = useEntityCache();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<ReferenceOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const lock = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  async function readCurrent(): Promise<{ entity: SirenEntity; action: SirenAction } | undefined> {
    cache.invalidate(rel);
    const entity = await cache.get(rel);
    const current = entity?.actions.find((candidate) => candidate.name === action.name);
    if (!entity || !current || referenceOptions(current) === undefined) {
      setChoices([]);
      setFailure('此操作已不可用，请查看最新对象。');
      return undefined;
    }
    setChoices(referenceOptions(current)!);
    return { entity, action: current };
  }

  async function load() {
    setBusy(true);
    setFailure(null);
    try {
      await readCurrent();
    } catch {
      setFailure('暂时无法读取当前材料，请重新打开后再试。');
    } finally {
      setBusy(false);
    }
  }

  async function remove(option: ReferenceOption) {
    if (blocked || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    let accepted = false;
    try {
      const current = await readCurrent();
      if (!current) return;
      const selected = matchingOption(referenceOptions(current.action)!, option.params);
      if (!selected) {
        setFailure('材料引用已变化，请重新选择。');
        return;
      }
      const guard = current.entity['guard-results']?.find(
        (entry) => entry.action === current.action.name,
      );
      if (
        guard?.blocked &&
        (guard.guards.filter((item) => !item.pass).length === 0 ||
          guard.guards.some((item) => !item.pass && item.name !== 'actor-is-human'))
      ) {
        setFailure(guard.reason ?? '当前条件不允许执行此操作。');
        return;
      }
      const result = await submit({ rel, action: current.action, params: selected.params });
      if (!result.ok) {
        setFailure(result.reason);
        return;
      }
      accepted = true;
      setChoices(null);
      cache.invalidateAfterExec(rel, result.entity, result.subject);
      notifyThreadUpdated(rel);
      onExecuted?.(rel);
      await readCurrent();
    } catch {
      setFailure(
        accepted
          ? '已移出引用，但暂时无法更新材料列表。请重新打开。'
          : '尚未取得执行结果，请刷新材料后核对。',
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  return (
    <div
      className="space-y-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open && !busy) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        data-nav="presentation:reference-selection"
        disabled={blocked || busy}
        title={blockReason}
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
      >
        {/* T60 UX 评审:图标统一前置,与「添加关联」的 ＋ 同侧对称。 */}
        <Minus aria-hidden />
        {action.title}
      </Button>
      {open && (
        <section id={id} aria-label={action.title} className="space-y-2 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">仅移出引用，原对象保留。</p>
          {choices?.length === 0 && <p className="text-sm">当前没有可移出的引用。</p>}
          {busy && (
            <p role="status" className="text-xs">
              正在核对当前材料…
            </p>
          )}
          <ul className="space-y-2">
            {choices?.map((option, index) => (
              <li key={index} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 break-words">{option.title}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-action={action.name}
                  aria-label={`移出 ${option.title}`}
                  disabled={busy || blocked}
                  onClick={() => void remove(option)}
                >
                  移出
                </Button>
              </li>
            ))}
          </ul>
          {failure && (
            <p role="alert" className="text-xs text-destructive">
              {failure}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
