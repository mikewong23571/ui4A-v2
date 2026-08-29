'use client';

import { useSearchParams } from 'next/navigation';

import { ApplicationEntryStrip } from '@/components/application-entry-strip';

import { canonicalReadQueryOf } from '@/render/canvas/collection-query';
import { PresentationSurfaceHost } from './presentation-surface-host';
import { ThreadDesk } from './thread-desk';
import { ThreadStageActions } from './thread-stage-actions';
import { EntityCacheProvider } from '../entity-cache-provider';

/** URL adapter for the shared Presentation host mounted by `/canvas`. */
export function CanvasBody() {
  const searchParams = useSearchParams();
  const scope = searchParams.get('scope') ?? undefined;
  // T35 §十:URL 声明工作线(或 ?rail=1 显式)时,工作台恒三栏——左书桌(纯读
  // 目录:叙述+工作集条目)/ 中舞台(唯一注视)/ 右助手(chat 由分栏态承担)。
  // 布局不变式:轨道只长条目不长面板,栏数恒为 3;零每实体特判:布局只看
  // 处境声明,不看实体类型。
  const threadId = searchParams.get('thread') ?? undefined;
  const railOn = threadId !== undefined;

  // T38 FR5:集合读面查询(offset + filter.*)是 URL 声明的舞台机械,与
  // scope/focus 同族——规范化后随 focus 取数进同一合同读(零页码推算,
  // 参数语义与 /api/entity 声明链接同形)。
  const collectionQuery = canonicalReadQueryOf(searchParams);

  const gazeParameters = {
    concern: searchParams.get('concern') ?? undefined,
    focus: searchParams.get('focus') ?? undefined,
    roots: searchParams.get('roots') ?? undefined,
    scope,
    sidecar: searchParams.get('sidecar') ?? undefined,
    refresh: searchParams.get('refresh') ?? undefined,
    thread: threadId,
    ...(collectionQuery === undefined ? {} : { collectionQuery }),
  };

  // T35 F-25:无注视(无 focus/concern/roots)时主位是入口层(应用目录),
  // 不再默认落 articles——articles 只是可注视对象之一。
  // T35 §十:focus 即本线时,舞台 = 协作引导 + 这条线的操作组(生命周期动作
  // 唯一常显处);书桌与舞台不重复渲染同一叙述或材料表单。
  const gazeIsThreadItself =
    threadId !== undefined && gazeParameters.focus === `thread:${threadId}`;
  // T37 FR3:scope 无任何注视参数时,默认落点 = 该应用的组合面(聚合虚主体,
  // `workspace:app:<scope>`);纯舞台机械——subject 推导,零应用落点布局组件。
  // 带 focus 的深链照旧优先,focus 表面不受影响。
  const appLandingFocus =
    scope !== undefined &&
    threadId === undefined &&
    gazeParameters.focus === undefined &&
    gazeParameters.concern === undefined &&
    gazeParameters.roots === undefined
      ? `workspace:app:${scope}`
      : undefined;
  const noGaze =
    (gazeParameters.focus === undefined &&
      gazeParameters.concern === undefined &&
      gazeParameters.roots === undefined &&
      threadId === undefined &&
      appLandingFocus === undefined) ||
    gazeIsThreadItself;

  const gaze =
    noGaze === true ? (
      <div className="grid gap-4">
        {gazeIsThreadItself ? (
          <>
            <div className="grid gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <p>
                这条线在左侧书桌常驻（目标/状态/工作集）。挂材料用书桌的「＋
                添加涉及对象」，推进这条线用下面的操作，或从应用进入具体对象——注视会跟着操作走。
              </p>
            </div>
            <ThreadStageActions threadId={threadId} scope={scope} />
            <ApplicationEntryStrip />
          </>
        ) : (
          <>
            <ApplicationEntryStrip />
            <p className="text-sm text-muted-foreground">
              从上方选择一个应用进入;或从「我的事」进入工作线。
            </p>
          </>
        )}
      </div>
    ) : (
      <PresentationSurfaceHost
        heading="共同注视"
        parameters={{
          ...gazeParameters,
          ...(appLandingFocus === undefined ? {} : { focus: appLandingFocus }),
        }}
      />
    );

  if (!railOn) {
    return <EntityCacheProvider scope={scope}>{gaze}</EntityCacheProvider>;
  }

  return (
    <EntityCacheProvider scope={scope}>
      <div className="flex items-start gap-6">
        <aside
          data-testid="thread-desk-rail"
          aria-label="本线"
          className="sticky top-12 max-h-[calc(100dvh-3rem)] w-96 shrink-0 overflow-x-hidden overflow-y-auto pr-1"
        >
          <ThreadDesk threadId={threadId} scope={scope} />
        </aside>
        <div className="min-w-0 flex-1">{gaze}</div>
      </div>
    </EntityCacheProvider>
  );
}
