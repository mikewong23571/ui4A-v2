'use client';

import { Dialog } from 'radix-ui';
import type { ReactNode, RefObject } from 'react';

import { Button } from '../ui/button';

/** Presentation-only modal around the existing runner. The form owns draft and submission. */
export function ActionFormHost({
  mode,
  open,
  title,
  submitting,
  onClose,
  triggerRef,
  receiptRef,
  children,
}: {
  mode: 'inline' | 'dialog';
  open: boolean;
  title: string;
  submitting: boolean;
  onClose(): void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  receiptRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  if (mode === 'inline') return <>{children}</>;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault();
          }}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (triggerRef.current?.disabled) receiptRef.current?.focus();
            else triggerRef.current?.focus();
          }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="sm" disabled={submitting}>
                关闭
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
