'use client';

import { Dialog } from 'radix-ui';
import { useRef, useState } from 'react';
import type { SirenEntity } from '@ui4a/engine';
import { usePresentationInteraction } from '@/components/canvas/interaction/presentation-interaction';
import { ActionGroup, isThreadMaterialAttach } from '../../../components/actions/action-group';
import { referenceOptions } from '../../../components/actions/reference-selection';
import { identityOf, relOf, statusOf } from '../../../components/canvas/desk/thread-desk-shared';
import { Button } from '../../../components/ui/button';
import { MaterialRemove } from './material-remove';
import { WorkMember } from './work-member';

export function MaterialDialog({
  entity,
  materials,
  unavailable,
  loading,
  onRefresh,
}: {
  entity: SirenEntity;
  materials: SirenEntity[];
  unavailable: boolean;
  loading: boolean;
  onRefresh(): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedRel, setSelectedRel] = useState<string>();
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  usePresentationInteraction(open);
  const rel = relOf(entity);
  const attachActions = entity.actions.filter((action) => isThreadMaterialAttach(rel, action));
  const selected = materials.find((member) => relOf(member) === selectedRel);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelectedRel(undefined);
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-nav="presentation:materials"
          data-testid="work-materials-trigger"
        >
          {unavailable ? '材料' : `材料 · ${materials.length}`}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="work-materials-dialog"
          className="fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold">材料</Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="sm">
                关闭
              </Button>
            </Dialog.Close>
          </div>
          {loading && (
            <p role="status" className="text-sm text-muted-foreground">
              读取中…
            </p>
          )}
          {unavailable && (
            <div className="flex items-center gap-3 py-4">
              <p role="alert" className="text-sm text-muted-foreground">
                暂时无法读取
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => void onRefresh()}>
                重试
              </Button>
            </div>
          )}
          <div hidden={selected !== undefined}>
            {attachActions.length > 0 && (
              <ActionGroup entity={{ ...entity, actions: attachActions }} />
            )}
            {!unavailable && materials.length === 0 && (
              <p className="py-5 text-sm text-muted-foreground">暂无材料</p>
            )}
            <ul className="divide-y divide-border/60">
              {materials.map((member) => (
                <li
                  key={relOf(member)}
                  className="flex items-start justify-between gap-3 py-3"
                  data-material-rel={relOf(member)}
                  data-work-material={relOf(member)}
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-left text-sm font-medium hover:underline"
                      data-nav="local:material-preview"
                      data-testid={`work-material-preview:${relOf(member)}`}
                      onClick={(event) => {
                        selectionTrigger.current = event.currentTarget;
                        setSelectedRel(relOf(member));
                      }}
                    >
                      {identityOf(member)}
                    </button>
                    {statusOf(member) && (
                      <p className="mt-1 text-xs text-muted-foreground">{statusOf(member)}</p>
                    )}
                  </div>
                  {entity.actions.flatMap((action) =>
                    (referenceOptions(action) ?? [])
                      .filter((option) => option.params.rel === relOf(member))
                      .map((option) => (
                        <MaterialRemove
                          key={`${action.name}:${JSON.stringify(option.params)}`}
                          entity={entity}
                          action={action}
                          option={option}
                        />
                      )),
                  )}
                </li>
              ))}
            </ul>
          </div>
          {selected && (
            <section aria-label="材料预览">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedRel(undefined);
                  requestAnimationFrame(() => selectionTrigger.current?.focus());
                }}
              >
                返回列表
              </Button>
              <WorkMember member={selected} readOnly />
            </section>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
