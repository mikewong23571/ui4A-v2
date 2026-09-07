'use client';
/**
 * G07 材料入口收敛:非书桌宿主(首页工作线区成员卡 / 工作线实体页)上的
 * 「添加关联」——与书桌(thread-desk)同一扇门。
 *
 * - 主路径 = 授权发现选择器 ObjectSelectorPanel(与书桌共用同一组件):候选
 *   来自 sitemap 集合面 + 页面缓存授权读,点击即挂 category=context;裸 rel
 *   RJSF 表单(ActionRunner 原样)降级为「高级」回退,不再是唯一入口;
 * - 提交走宿主 submit 适配器(surfaceSubmit/directSubmit——同一 /api/exec
 *   裁决,服务端仍是最终裁判);成功后经页面缓存精确失效 + 广播
 *   THREAD_UPDATED_EVENT(同页书桌/舞台据此重读),与书桌执行语义对齐;
 * - 已在本线(context)的候选禁选(重复不可选);本组件只提交 attach,
 *   移出不删除对象本身(合同 detach 语义不变,由各宿主既有入口承担);
 * - 「已添加」集合读线程实体的授权投影(properties.context),不自造清单。
 */
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ObjectSelectorPanel } from '../canvas/desk/thread-desk-selector';
import { THREAD_UPDATED_EVENT, notifyThreadUpdated } from '../canvas/desk/thread-desk-shared';
import { useEntityCache } from '../entity-cache-provider';
import { ActionRunner } from '../action-runner';
import { Button } from '../ui/button';
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attachedRels, setAttachedRels] = useState<ReadonlySet<string>>(new Set());

  // 已添加集合:线程实体授权读;仅在面板打开/线更新事件后取,零常驻轮询
  // (setState 一律置于 then/事件回调,不落 react-hooks/set-state-in-effect)。
  const reloadAttached = useCallback(async (): Promise<void> => {
    const entity = await cache.get(rel).catch(() => null);
    setAttachedRels(contextRelsOf(entity));
  }, [cache, rel]);

  // 同页书桌/其它入口挂入或移出后重读(context 是线的派生投影)。
  useEffect(() => {
    const sync = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === rel) void reloadAttached();
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
        void reloadAttached();
      }
      return result;
    },
    [cache, rel, reloadAttached, submit],
  );

  const attach = useCallback(
    async (memberRel: string): Promise<boolean> => {
      setBusy(true);
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
      } finally {
        setBusy(false);
      }
    },
    [action, onExecuted, rel, threadSubmit],
  );

  const openSelector = (): void => {
    setSelectorOpen((open) => !open);
    void reloadAttached();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="thread-add-material"
          data-nav="local:thread-add-material"
          aria-expanded={selectorOpen}
          disabled={blocked || busy}
          onClick={openSelector}
        >
          <Plus aria-hidden />
          {action.title}
        </Button>
      </div>
      {blocked && blockReason !== undefined ? (
        <p role="status" className="text-xs text-muted-foreground">
          {blockReason}
        </p>
      ) : null}
      {selectorOpen && (
        <>
          <ObjectSelectorPanel
            attachedRels={attachedRels}
            busy={busy}
            onPick={attach}
            onClose={() => {
              setSelectorOpen(false);
              setAdvancedOpen(false);
            }}
          />
          {/* 高级回退入口收进选择器面板底部:裸 rel 表单不再与主路径并列常驻。 */}
          <button
            type="button"
            data-testid="thread-add-material-advanced"
            data-nav="local:thread-add-material-advanced"
            aria-expanded={advancedOpen}
            disabled={busy}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
          >
            高级:手动填写
          </button>
        </>
      )}
      {/* 高级回退:合同声明的原始表单(类别 + 裸 rel)原样可达,零行为改动。 */}
      {advancedOpen && (
        <div data-testid="thread-add-material-advanced-form">
          <ActionRunner
            rel={rel}
            action={action}
            submit={threadSubmit}
            onExecuted={onExecuted}
            blocked={blocked}
            blockReason={blockReason}
          />
        </div>
      )}
      {failure !== null && (
        <p
          role="alert"
          data-testid="thread-add-material-failure"
          className="text-xs text-destructive"
        >
          {failure}
        </p>
      )}
    </div>
  );
}
