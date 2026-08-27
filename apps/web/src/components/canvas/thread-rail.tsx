'use client';
/**
 * T35 W1/W2:线工作台左轨——本线叙述面 + 钉住面常驻。
 *
 * 数据全部来自合同投影(thread 叙述 = E-1;钉住面 = 用户在注视面 📌 的选择,
 * localStorage 按线隔离,与 ui4a.chat.mode 同规:呈现偏好,非真相;显式 URL
 * roots 优先于钉住集)。钉住变更经 window 事件通知本轨重载(跨 A2UI 渲染边界
 * 不走 React context)。
 */
import { useEffect, useState } from 'react';

import { PresentationSurfaceHost } from './presentation-surface-host';
import { EntityCacheProvider } from '../entity-cache-provider';

export function threadPinsKey(threadId: string): string {
  return `ui4a.thread.pins.${threadId}`;
}

export function readThreadPins(threadId: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(threadPinsKey(threadId));
    if (raw === undefined || raw === null || raw === '') return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function writeThreadPin(threadId: string, concern: string, pinned: boolean): void {
  const base = readThreadPins(threadId).filter((entry) => entry !== concern);
  const next = pinned ? [...base, concern] : base;
  try {
    globalThis.localStorage?.setItem(threadPinsKey(threadId), JSON.stringify(next));
  } catch {
    // 隐私模式等:钉住退化为内存态,无损
  }
  window.dispatchEvent(new CustomEvent('ui4a:thread-pins-changed'));
}

export interface ThreadRailProps {
  threadId: string;
  scope?: string;
}

/** 线工作台左轨:本线叙述(roots 首位)+ 钉住面;视口内常驻。 */
export function ThreadRail({ threadId, scope }: ThreadRailProps) {
  const threadRel = `thread:${threadId}`;
  const [pins, setPins] = useState<string[]>(() => readThreadPins(threadId));

  useEffect(() => {
    setPins(readThreadPins(threadId));
    const sync = (): void => setPins(readThreadPins(threadId));
    window.addEventListener('ui4a:thread-pins-changed', sync);
    return () => window.removeEventListener('ui4a:thread-pins-changed', sync);
  }, [threadId]);

  const roots = [threadRel, ...pins.filter((pin) => pin !== threadRel)].join(',');

  return (
    <EntityCacheProvider scope={scope}>
      <PresentationSurfaceHost
        heading="本线"
        parameters={{ roots, thread: threadId, scope }}
      />
    </EntityCacheProvider>
  );
}
