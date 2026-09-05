'use client';
/**
 * 画布 URL 适配层(D46:壳只提供位置、阅读宿主与返回/材料入口)。
 *
 * T56 D78 决定 1:工作线页面是主内容主体——`thread=T&focus=thread:T` 与
 * `thread=T`(无显式 focus,落本线概览 `thread:T`)和对象深链共用同一条
 * Presentation 管线,消费 P1 的 thread 投影 surface(目标/生命周期/成员卡),
 * 不再旁路渲染说明书/应用书架;线生命周期动作由本线 surface 的声明动作区
 * 承载。T37 的应用组合面落点(scope 无注视)与零注视入口层保持不变。
 * 线程页壳条(返回本线/相关材料入口)在 desk/thread-workspace-bar;默认无
 * 永久材料栏(D78 决定 1);助手并排/覆盖按剩余宽度判定,见
 * chat/workspace-shell/layout-decision(D78 单点)。
 */
import { useCallback, useRef } from 'react';

import { useSearchParams } from 'next/navigation';

import { ApplicationEntryStrip } from '@/components/application-entry-strip';

import { canonicalReadQueryOf } from '@/render/canvas/collection-query';

import { ThreadWorkspaceBar } from './desk/thread-workspace-bar';
import { PresentationSurfaceHost } from './presentation-surface-host';
import { EntityCacheProvider } from '../entity-cache-provider';

/** URL adapter for the shared Presentation host mounted by `/canvas`. */
export function CanvasBody() {
  const searchParams = useSearchParams();
  const scope = searchParams.get('scope') ?? undefined;
  const threadId = searchParams.get('thread') ?? undefined;
  const explicitFocus = searchParams.get('focus') ?? undefined;
  // T38 FR5:集合读面查询(offset + filter.*)是 URL 声明的舞台机械,与
  // scope/focus 同族——规范化后随 focus 取数进同一合同读(零页码推算,
  // 参数语义与 /api/entity 声明链接同形)。
  const collectionQuery = canonicalReadQueryOf(searchParams);

  // T37 FR3:scope 无任何注视参数时,默认落点 = 该应用的组合面(聚合虚主体,
  // `workspace:app:<scope>`);带 focus 的深链照旧优先。D78:thread 页无显式
  // focus 落本线概览(thread:T,可解释的本线落点),与对象深链同一管线。
  const appLandingFocus =
    scope !== undefined &&
    threadId === undefined &&
    explicitFocus === undefined &&
    searchParams.get('concern') === null &&
    searchParams.get('roots') === null
      ? `workspace:app:${scope}`
      : undefined;
  const focus =
    explicitFocus ?? appLandingFocus ?? (threadId === undefined ? undefined : `thread:${threadId}`);
  // T35 F-25:真正的零注视(无 thread/scope/focus/concern/roots)时主位是
  // 入口层(应用目录),articles 只是可注视对象之一,不默认落。
  const noGaze =
    focus === undefined &&
    searchParams.get('concern') === null &&
    searchParams.get('roots') === null;

  const mainRegionRef = useRef<HTMLDivElement | null>(null);
  // 材料目录选中条目后聚焦主阅读区(目标标题在区域顶部;design §1)。
  const focusMainRegion = useCallback(() => {
    mainRegionRef.current?.focus();
  }, []);

  const gaze =
    noGaze === true ? (
      <div className="grid gap-4">
        <ApplicationEntryStrip />
        <p className="text-sm text-muted-foreground">
          从上方选择一个应用进入;或从「我的事」进入工作线。
        </p>
      </div>
    ) : (
      <PresentationSurfaceHost
        parameters={{
          concern: searchParams.get('concern') ?? undefined,
          ...(focus === undefined ? {} : { focus }),
          roots: searchParams.get('roots') ?? undefined,
          scope,
          sidecar: searchParams.get('sidecar') ?? undefined,
          refresh: searchParams.get('refresh') ?? undefined,
          ...(threadId === undefined ? {} : { thread: threadId }),
          ...(collectionQuery === undefined ? {} : { collectionQuery }),
        }}
      />
    );

  if (threadId === undefined) {
    return <EntityCacheProvider scope={scope}>{gaze}</EntityCacheProvider>;
  }

  return (
    <EntityCacheProvider scope={scope}>
      <div className="grid gap-4">
        <ThreadWorkspaceBar
          threadId={threadId}
          scope={scope}
          onThreadSelf={explicitFocus === undefined || explicitFocus === `thread:${threadId}`}
          onEntryNavigate={focusMainRegion}
        />
        <div ref={mainRegionRef} tabIndex={-1} className="min-w-0 focus:outline-none">
          {gaze}
        </div>
      </div>
    </EntityCacheProvider>
  );
}
