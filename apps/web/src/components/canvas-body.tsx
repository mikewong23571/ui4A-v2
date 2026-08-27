'use client';

import { useSearchParams } from 'next/navigation';

import { ApplicationEntryStrip } from '@/components/application-entry-strip';

import { PresentationSurfaceHost } from './canvas/presentation-surface-host';
import { ThreadRail } from './canvas/thread-rail';
import { EntityCacheProvider } from './entity-cache-provider';

/** URL adapter for the shared Presentation host mounted by `/canvas`. */
export function CanvasBody() {
  const searchParams = useSearchParams();
  const scope = searchParams.get('scope') ?? undefined;
  // T35 W1:URL 声明工作线(或 ?rail=1 显式)时,工作台切三栏——左轨(本线叙述+
  // 钉住面,视口内常驻)/ 中注视面;右栏 chat 由分栏态承担。零每实体特判:布局
  // 只看处境声明,不看实体类型。
  const threadId = searchParams.get('thread') ?? undefined;
  const railOn = threadId !== undefined;

  const gazeParameters = {
    concern: searchParams.get('concern') ?? undefined,
    focus: searchParams.get('focus') ?? undefined,
    roots: searchParams.get('roots') ?? undefined,
    scope,
    sidecar: searchParams.get('sidecar') ?? undefined,
    refresh: searchParams.get('refresh') ?? undefined,
    thread: threadId,
  };

  // T35 F-25:无注视(无 focus/concern/roots)时主位是入口层(应用目录),
  // 不再默认落 articles——articles 只是可注视对象之一。
  const noGaze =
    gazeParameters.focus === undefined &&
    gazeParameters.concern === undefined &&
    gazeParameters.roots === undefined &&
    threadId === undefined;

  const gaze =
    noGaze === true ? (
      <div className="grid gap-4">
        <ApplicationEntryStrip />
        <p className="text-sm text-muted-foreground">
          从上方选择一个应用进入;或从「我的事」进入工作线。
        </p>
      </div>
    ) : (
      <PresentationSurfaceHost heading="共同注视" parameters={gazeParameters} />
    );

  if (!railOn) {
    return <EntityCacheProvider scope={scope}>{gaze}</EntityCacheProvider>;
  }

  return (
    <EntityCacheProvider scope={scope}>
      <div className="flex items-start gap-6">
        <aside
          data-testid="thread-rail"
          aria-label="本线"
          className="sticky top-12 max-h-[calc(100dvh-3rem)] w-80 shrink-0 overflow-y-auto pr-1"
        >
          <ThreadRail threadId={threadId} scope={scope} />
        </aside>
        <div className="min-w-0 flex-1">{gaze}</div>
      </div>
    </EntityCacheProvider>
  );
}
