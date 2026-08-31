'use client';
/**
 * T35 §十定稿:线工作台左轨 = 书桌(纯读目录)。
 *
 * - **pin = 挂进本线工作集(上下文引用)**,不渲染整面 surface——此前 W2 把
 *   pin 做成"左栏实时渲染整面",是竖向塞爆的结构性根因;实时展示是舞台(注视)
 *   的职责,书桌只列条目(标题+状态),点击唤起注视;
 * - 工作集 = 线 context 成员(合同真相,detach 移出) + 钉住页(呈现偏好,
 *   localStorage 按线隔离,与 ui4a.chat.mode 同规)合并去重;条目操作 hover 才露
 *   (按钮跟着注视走:书桌几乎零常显按钮);
 * - 「＋添加涉及对象」是书桌唯一常显操作:点开对象选择器(thread-desk-selector),
 *   候选 = sitemap 集合面成员,点击即挂 category=context——F-27② 裸填 rel 退位;
 * - 线动作跨书桌/舞台协调走 ui4a:thread-updated 事件(thread-desk-shared),
 *   与 ui4a:thread-pins-changed 同规:跨渲染边界不假设同一 React 子树;
 * - 零每实体特判:身份/状态一律读实体声明字段(identity/title/statusText)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';

import { useEntityCache } from '../entity-cache-provider';
import { execAction } from '../exec-client';
import { ObjectSelectorPanel } from './thread-desk-selector';
import {
  THREAD_UPDATED_EVENT,
  firstString,
  identityOf,
  notifyThreadUpdated,
  relOf,
  statusOf,
  type ThreadDeskProps,
} from './thread-desk-shared';

export function threadPinsKey(threadId: string): string {
  return `ui4a.thread.pins.${threadId}`;
}

export function readThreadPins(threadId: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(threadPinsKey(threadId));
    if (raw === undefined || raw === null || raw === '') return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
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

interface DeskEntry {
  rel: string;
  identity: string;
  status?: string;
  inContext: boolean;
  pinned: boolean;
}

/** 线工作台书桌:本线叙述(纯读) + 工作集条目 + 对象选择器。 */
export function ThreadDesk({ threadId, scope }: ThreadDeskProps) {
  const cache = useEntityCache();
  const threadRel = `thread:${threadId}`;
  const [thread, setThread] = useState<SirenEntity | null>(null);
  const [missing, setMissing] = useState(false);
  const [pins, setPins] = useState<string[]>(() => readThreadPins(threadId));
  const [pinEntities, setPinEntities] = useState<Record<string, SirenEntity>>({});
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const entity = await cache.get(threadRel).catch(() => null);
    setThread(entity);
    setMissing(entity === null);
  }, [cache, threadRel]);

  // 挂载首读:setState 置于 then 回调(effect 体内不直呼含 setState 的函数,
  // react-hooks/set-state-in-effect);reload 供事件回调使用。
  useEffect(() => {
    let cancelled = false;
    cache
      .get(threadRel)
      .then((entity) => {
        if (!cancelled) {
          setThread(entity);
          setMissing(entity === null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cache, threadRel]);

  useEffect(() => {
    // 钉住集与线更新事件回调内 setState(事件为异步源,不在 effect 体直呼)。
    const sync = (): void => setPins(readThreadPins(threadId));
    window.addEventListener('ui4a:thread-pins-changed', sync);
    window.addEventListener(THREAD_UPDATED_EVENT, sync);
    return () => {
      window.removeEventListener('ui4a:thread-pins-changed', sync);
      window.removeEventListener(THREAD_UPDATED_EVENT, sync);
    };
  }, [threadId]);

  // 合同执行事件(任意 rel)→ 重读叙述与工作集:context 成员的状态指针是线的
  // 派生投影,成员上的 exec(在注视面发生)同样改变它。线缓存未被执行方失效,
  // 此处先失效再重读(每次合同 exec 多一次线读,正确性优先)。
  useEffect(() => {
    const sync = (): void => {
      cache.invalidate(threadRel);
      void reload();
    };
    window.addEventListener(THREAD_UPDATED_EVENT, sync);
    return () => window.removeEventListener(THREAD_UPDATED_EVENT, sync);
  }, [cache, threadRel, reload]);

  // 注视面/任意合同 exec 后,钉住页的缓存身份可能过期(surfaceSubmit 已精确
  // 失效页面缓存,此处只需放弃书桌侧快照重读)——清空 pinEntities 触发重取。
  const [pinRefresh, setPinRefresh] = useState(0);
  useEffect(() => {
    const sync = (): void => setPinRefresh((n) => n + 1);
    window.addEventListener(THREAD_UPDATED_EVENT, sync);
    return () => window.removeEventListener(THREAD_UPDATED_EVENT, sync);
  }, []);

  const contextRels = useMemo(() => {
    const context = thread?.properties.context;
    return new Set(
      Array.isArray(context) ? context.filter((v): v is string => typeof v === 'string') : [],
    );
  }, [thread]);

  // 钉住页身份/状态取数:仅未入 context 的钉住 rel(context 成员身份已随线投影)。
  const pinOnly = useMemo(
    () => pins.filter((rel) => rel !== threadRel && !contextRels.has(rel)),
    [pins, threadRel, contextRels],
  );
  useEffect(() => {
    let cancelled = false;
    // pinRefresh 变化(任意合同 exec 后)清快照全量重读——cache 已被 surfaceSubmit
    // 精确失效,重读即新投影。
    const known = pinRefresh === 0 ? pinEntities : {};
    void (async () => {
      for (const rel of pinOnly) {
        if (cancelled) return;
        if (known[rel] !== undefined) continue;
        const entity = await cache.get(rel).catch(() => null);
        if (cancelled) return;
        if (entity !== null) setPinEntities((prev) => ({ ...prev, [rel]: entity }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pinOnly, cache, pinEntities, pinRefresh]);

  const entries = useMemo<DeskEntry[]>(() => {
    const list: DeskEntry[] = [];
    for (const member of thread?.entities ?? []) {
      const rel = relOf(member);
      if (rel === '') continue;
      list.push({
        rel,
        identity: firstString(member.properties.identity, member.properties.title) ?? rel,
        status: statusOf(member),
        inContext: true,
        pinned: pins.includes(rel),
      });
    }
    for (const rel of pinOnly) {
      const entity = pinEntities[rel];
      list.push({
        rel,
        identity: entity !== undefined ? identityOf(entity) : rel,
        status: entity !== undefined ? statusOf(entity) : undefined,
        inContext: false,
        pinned: true,
      });
    }
    return list;
  }, [thread, pins, pinOnly, pinEntities]);

  const runThreadAction = useCallback(
    async (action: string, params?: Record<string, unknown>): Promise<boolean> => {
      setBusy(true);
      setFailure(null);
      try {
        const result = await execAction({ rel: threadRel, action, params, scope });
        if (!result.ok) {
          setFailure(`[${result.layer}] ${result.reason}`);
          return false;
        }
        cache.invalidateAfterExec(threadRel, result.entity, result.subject);
        notifyThreadUpdated(threadRel);
        return true;
      } catch (error) {
        setFailure(`[network] ${error instanceof Error ? error.message : String(error)}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [cache, scope, threadRel],
  );

  const removeEntry = (entry: DeskEntry): void => {
    if (entry.inContext) void runThreadAction('detach', { category: 'context', rel: entry.rel });
    if (entry.pinned) writeThreadPin(threadId, entry.rel, false);
  };

  if (missing) {
    return (
      <div data-testid="thread-desk">
        <p className="text-sm text-muted-foreground">本线暂不可读。</p>
      </div>
    );
  }

  const statusText = firstString(thread?.properties.statusText);
  const resume = firstString(thread?.properties.resume);
  // F-08:来源只消费投影的可读字段(goalSourceText);不可解析时投影省略该键,
  // 书桌干净省略来源行,裸 source 只在 raw 层可达。
  const goalSource = firstString(
    (thread?.properties as { goalSourceText?: unknown } | undefined)?.goalSourceText,
  );

  return (
    <div data-testid="thread-desk" className="flex flex-col gap-3 text-sm">
      <section data-testid="desk-narrative" className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base leading-snug font-semibold">
            {firstString(thread?.properties.identity) ?? threadId}
          </h2>
          {statusText !== undefined && (
            <Badge
              variant="secondary"
              data-testid="desk-status"
              className="shrink-0 rounded px-1.5 py-0 text-[11px] font-normal"
            >
              {statusText}
            </Badge>
          )}
        </div>
        {resume !== undefined && <p className="mt-1 text-xs text-muted-foreground">{resume}</p>}
        {goalSource !== undefined && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/70">来源:{goalSource}</p>
        )}
      </section>

      <section data-testid="desk-working-set" className="rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">工作集（{entries.length}）</p>
          <button
            type="button"
            data-testid="desk-add-material"
            data-nav="local:desk-add-material"
            aria-expanded={selectorOpen}
            disabled={busy}
            onClick={() => setSelectorOpen((open) => !open)}
            className="rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            ＋ 添加涉及对象
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            还没有涉及对象。点「＋ 添加涉及对象」把相关材料挂进本线，助手在线内工作时就能看到。
          </p>
        ) : (
          <ul className="mt-1 divide-y" data-testid="desk-entries">
            {entries.map((entry) => (
              <li
                key={`${entry.rel}:${entry.inContext ? 'context' : 'pin'}`}
                className="group flex items-center gap-2 py-1.5"
                data-desk-entry={entry.rel}
              >
                <a
                  href={`/canvas?thread=${encodeURIComponent(threadId)}&focus=${encodeURIComponent(entry.rel)}${scope !== undefined ? `&scope=${encodeURIComponent(scope)}` : ''}`}
                  data-nav={`local:desk-entry:${entry.rel}`}
                  title={entry.identity}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {entry.identity}
                </a>
                {entry.status !== undefined && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 rounded px-1 py-0 text-[10px] font-normal text-muted-foreground"
                  >
                    {entry.status}
                  </Badge>
                )}
                <button
                  type="button"
                  data-testid={`desk-remove:${entry.rel}`}
                  data-nav={`local:desk-remove:${entry.rel}`}
                  disabled={busy}
                  onClick={() => removeEntry(entry)}
                  className="shrink-0 text-[11px] text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-destructive disabled:opacity-0"
                >
                  {entry.inContext ? '移出' : '取消钉住'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectorOpen && (
          <ObjectSelectorPanel
            attachedRels={contextRels}
            busy={busy}
            onPick={(rel) => runThreadAction('attach', { category: 'context', rel })}
            onClose={() => setSelectorOpen(false)}
          />
        )}
      </section>
      {failure !== null && (
        <p role="alert" data-testid="desk-failure" className="text-xs text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}
