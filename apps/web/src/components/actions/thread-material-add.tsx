'use client';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { usePresentationInteraction } from '../canvas/interaction/presentation-interaction';
import { Dialog } from 'radix-ui';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ObjectSelectorPanel } from '../canvas/desk/thread-desk-selector';
import { THREAD_UPDATED_EVENT, notifyThreadUpdated } from '../canvas/desk/thread-desk-shared';
import { useEntityCache } from '../entity-cache-provider';
import { identityOf } from '../canvas/desk/thread-desk-shared';
import { Button } from '../ui/button';
import { ActionRunner } from '../action-runner';
import type { ActionSubmit, ActionSubmitInput } from './action-submit';

export interface ThreadMaterialAddProps {
  /** 线的合同 rel(properties.rel,thread:<id>)。 */
  rel: string;
  /** 合同声明的 attach 动作(字段集/标题完全来自声明)。 */
  action: SirenAction;
  /** 宿主提交适配器(同一裁决器;页面缓存失效与线程事件由本组件追加)。 */
  submit: ActionSubmit;
  onExecuted?: (rel: string) => void;
  /** guard-results 注入:谓词投影 = disabled。 */
  blocked?: boolean;
  blockReason?: string;
}

/** 线 context 引用集合:读线程实体授权投影,不解析/不发明。 */
function contextRelsOf(entity: SirenEntity | null): ReadonlySet<string> {
  const context = entity?.properties.context;
  return new Set(
    Array.isArray(context)
      ? context.filter((value): value is string => typeof value === 'string')
      : [],
  );
}

export function ThreadMaterialAdd({
  rel,
  action,
  submit,
  onExecuted,
  blocked = false,
  blockReason,
}: ThreadMaterialAddProps) {
  const cache = useEntityCache();
  const [selectorOpen, setSelectorOpen] = useState(false);
  usePresentationInteraction(selectorOpen);
  const [targetTitle, setTargetTitle] = useState<string>();
  const [targetUnavailable, setTargetUnavailable] = useState(false);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attachedRels, setAttachedRels] = useState<ReadonlySet<string>>(new Set());

  // 已添加集合:线程实体授权读;仅在面板打开/线更新事件后取,零常驻轮询
  // (setState 一律置于 then/事件回调,不落 react-hooks/set-state-in-effect)。
  const reloadAttached = useCallback(async (): Promise<void> => {
    const entity = await cache.get(rel).catch(() => null);
    if (entity === null) throw new Error('暂时无法读取工作线');
    setAttachedRels(contextRelsOf(entity));
    setTargetTitle(identityOf(entity));
  }, [cache, rel]);

  // 同页书桌/其它入口挂入或移出后重读(context 是线的派生投影)。
  useEffect(() => {
    const sync = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === rel)
        void reloadAttached().catch(() => setFailure('暂时无法读取工作线'));
    };
    window.addEventListener(THREAD_UPDATED_EVENT, sync);
    return () => window.removeEventListener(THREAD_UPDATED_EVENT, sync);
  }, [rel, reloadAttached]);

  // 收敛后的提交适配器:宿主裁决之上追加线的缓存失效与更新广播(与书桌
  // runThreadAction 的执行后语义一致);拒绝/异常如实回传,不伪造成功。
  const threadSubmit = useCallback(
    async (input: ActionSubmitInput) => {
      const result = await submit(input);
      if (result.ok) {
        cache.invalidateAfterExec(rel, result.entity, result.subject);
        notifyThreadUpdated(rel);
        void reloadAttached().catch(() => setFailure('暂时无法读取工作线'));
      }
      return result;
    },
    [cache, rel, reloadAttached, submit],
  );

  const attach = useCallback(
    async (memberRel: string): Promise<boolean> => {
      setFailure(null);
      try {
        const result = await threadSubmit({
          rel,
          action,
          params: { category: 'context', rel: memberRel },
        });
        if (!result.ok) {
          setFailure(`[${result.layer}] ${result.reason}`);
          return false;
        }
        onExecuted?.(rel);
        return true;
      } catch (error) {
        setFailure(`[network] ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    },
    [action, onExecuted, rel, threadSubmit],
  );

  const openSelector = (): void => {
    setSelectorOpen(true);
    setFailure(null);
    setLoadingTarget(true);
    setTargetUnavailable(false);
    cache.invalidate(rel);
    void reloadAttached()
      .catch(() => {
        setTargetUnavailable(true);
        setFailure('暂时无法读取工作线');
      })
      .finally(() => setLoadingTarget(false));
  };

  return (
    <div className="flex flex-col gap-2">
      <Dialog.Root
        open={selectorOpen}
        onOpenChange={(open) => {
          if (!busy) setSelectorOpen(open);
        }}
      >
        <Dialog.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="thread-add-material"
            data-nav="local:thread-add-material"
            disabled={blocked || busy}
            onClick={openSelector}
          >
            <Plus aria-hidden />
            {action.title}
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
            onInteractOutside={(event) => event.preventDefault()}
            className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg"
          >
            <Dialog.Title className="mb-3 text-lg font-semibold">{action.title}</Dialog.Title>
            {targetUnavailable ? (
              <div className="flex justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectorOpen(false)}
                >
                  关闭
                </Button>
                <Button type="button" size="sm" onClick={openSelector}>
                  重试
                </Button>
              </div>
            ) : (
              <ObjectSelectorPanel
                attachedRels={attachedRels}
                busy={busy || loadingTarget || blocked}
                targetTitle={targetTitle}
                onPick={attach}
                onSubmittingChange={setBusy}
                onClose={() => setSelectorOpen(false)}
              />
            )}
            {!targetUnavailable && !loadingTarget && (
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">其他关联</summary>
                <div className="pt-3">
                  <ActionRunner
                    rel={rel}
                    action={action}
                    submit={threadSubmit}
                    onExecuted={onExecuted}
                    blocked={blocked || busy}
                    blockReason={blockReason}
                  />
                </div>
              </details>
            )}
            {failure !== null && (
              <p
                role="alert"
                data-testid="thread-add-material-failure"
                className="mt-2 text-xs text-destructive"
              >
                {failure}
              </p>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {blocked && blockReason !== undefined && (
        <p role="status" className="text-xs text-muted-foreground">
          {blockReason}
        </p>
      )}
    </div>
  );
}
