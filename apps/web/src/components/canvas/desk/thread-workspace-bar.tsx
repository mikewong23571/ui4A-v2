'use client';
/**
 * T56 D78/design §1:本线壳条(线程页常显家具,替代 T35 恒三栏的常驻书桌栏)。
 *
 * - 对象页(focus ≠ 本线):「返回本线」客户端导航入口 + 线身份/生命周期
 *   (US01 恢复一件事、FR2 常显);身份/状态只消费投影声明字段,零发明;
 *   本线概览页(surface 自携目标/状态)不重复叙述。
 * - 「相关材料(n)」展开入口(FR4/D78 决定 1):默认收起、无永久材料栏、
 *   不自动打开任何材料;计数 = 可见 context 成员卡(membership;US06:仅钉
 *   住页是固定视图偏好,不冒充材料);线不可读时不伪称 0。覆盖层复用
 *   ThreadDesk 目录(叙述+工作集+固定视图+添加选择器),选中条目即经客户端
 *   导航落对象,关闭覆盖层并聚焦主阅读区。
 * - 覆盖层交互(design §1):明确关闭、Escape 关闭、关闭后焦点恢复到触发键;
 *   控件带可见焦点圈,操作不依赖 hover。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';

import type { SirenEntity } from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';

import { useEntityCache } from '../../entity-cache-provider';
import { ThreadDesk } from './thread-desk';
import { THREAD_UPDATED_EVENT, firstString, relOf } from './thread-desk-shared';

export interface ThreadWorkspaceBarProps {
  threadId: string;
  scope?: string;
  /** 当前注视即本线概览(壳条只露材料入口,不重复叙述线身份/状态)。 */
  onThreadSelf: boolean;
  /** 材料条目发起客户端导航后的回调(主阅读区聚焦目标标题区)。 */
  onEntryNavigate: () => void;
}

export function ThreadWorkspaceBar({
  threadId,
  scope,
  onThreadSelf,
  onEntryNavigate,
}: ThreadWorkspaceBarProps) {
  const cache = useEntityCache();
  const threadRel = `thread:${threadId}`;
  const [thread, setThread] = useState<SirenEntity | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // 挂载首读:setState 置于 then 回调(effect 体内不直呼含 setState 的函数)。
  useEffect(() => {
    let cancelled = false;
    cache
      .get(threadRel)
      .then((entity) => {
        if (!cancelled) setThread(entity);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cache, threadRel]);

  // 合同执行(任意 rel)失效线缓存重读——context 成员卡计数随 attach/detach
  // 即时变化。pin 不再监听:材料计数 = membership(P3.1 US06),固定视图
  // 偏好变化不改变材料数。
  useEffect(() => {
    const syncThread = (): void => {
      cache.invalidate(threadRel);
      cache
        .get(threadRel)
        .then((entity) => setThread(entity))
        .catch(() => {});
    };
    window.addEventListener(THREAD_UPDATED_EVENT, syncThread);
    return () => window.removeEventListener(THREAD_UPDATED_EVENT, syncThread);
  }, [cache, threadRel]);

  // 相关材料(n) = 可见 context 成员(membership 真相);仅钉住页是固定视图
  // 偏好,不冒充材料(US06/P3.1)。线不可读时不伪称 0。
  const materialCount = useMemo(() => {
    if (thread === null) return undefined;
    return (thread.entities ?? []).filter((member) => relOf(member) !== '').length;
  }, [thread]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const pickEntry = useCallback(() => {
    setOpen(false);
    onEntryNavigate();
  }, [onEntryNavigate]);

  // 覆盖层 Escape 关闭(design §1;焦点恢复由 close 承担)。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const identity = firstString(thread?.properties.identity);
  const statusText = firstString(thread?.properties.statusText);
  const backHref = `/canvas?thread=${encodeURIComponent(threadId)}&focus=${encodeURIComponent(threadRel)}${scope === undefined ? '' : `&scope=${encodeURIComponent(scope)}`}`;

  return (
    <div className="grid gap-2" data-testid="thread-workspace-bar">
      <div className="flex flex-wrap items-center gap-2">
        {onThreadSelf ? null : (
          <>
            <Link
              href={backHref}
              data-nav="local:thread-back"
              className="rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              返回本线
            </Link>
            {identity !== undefined && (
              <span
                data-testid="thread-bar-identity"
                title={identity}
                className="min-w-0 max-w-64 truncate text-sm font-medium text-foreground"
              >
                {identity}
              </span>
            )}
            {statusText !== undefined && (
              <Badge
                variant="secondary"
                data-testid="thread-bar-status"
                className="shrink-0 rounded px-1.5 py-0 text-[11px] font-normal"
              >
                {statusText}
              </Badge>
            )}
          </>
        )}
        <button
          type="button"
          ref={triggerRef}
          data-nav="local:thread-materials"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((current) => !current)}
          className="ml-auto rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {materialCount === undefined ? '相关材料' : `相关材料（${materialCount}）`}
        </button>
      </div>
      {open && (
        <div
          role="dialog"
          aria-label="相关材料"
          data-testid="thread-materials-dialog"
          className="rounded-lg border bg-card p-3 shadow-md"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">相关材料</p>
            <button
              type="button"
              data-nav="local:thread-materials-close"
              onClick={close}
              className="rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              关闭
            </button>
          </div>
          <ThreadDesk threadId={threadId} scope={scope} onEntryNavigate={pickEntry} />
        </div>
      )}
    </div>
  );
}
