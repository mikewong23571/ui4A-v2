'use client';
/**
 * 输入区附近的当前范围提示(T56 P3.3 / US08「当前输入范围正确」;design §2
 * 「当前提问对象」行)。取数与发送侧 clientView(clientViewReportForLocation
 * → presenceObservationForLocation)同一 URL observation 单一来源,经 shell/
 * presence 共用的 useLocationObservation;不新建 attention/authorization
 * store。未定位显式「未定位」,不做任何推断。
 */
import { Suspense } from 'react';

import { useLocationObservation } from '@/presence/location';
import type { PresenceObservation } from '@/presence/client';

function observationLabel(observation: PresenceObservation): string {
  const parts: string[] = [];
  if (observation.thread !== null) parts.push(`线 ${observation.thread}`);
  if (observation.focus !== null) {
    parts.push(
      `注视 ${typeof observation.focus === 'string' ? observation.focus : observation.focus.selection.join('、')}`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : '未定位';
}

function Strip() {
  const { observation } = useLocationObservation();
  return (
    <div
      data-testid="input-scope-strip"
      data-thread={observation.thread ?? undefined}
      data-scope={observation.scope ?? undefined}
      data-focus={
        observation.focus === null
          ? undefined
          : typeof observation.focus === 'string'
            ? observation.focus
            : observation.focus.selection.join(',')
      }
      className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground"
    >
      输入范围:{observationLabel(observation)}
    </div>
  );
}

/** useSearchParams 的 Suspense 边界(静态渲染安全);加载期不占位。 */
export function InputScopeStrip() {
  return (
    <Suspense fallback={null}>
      <Strip />
    </Suspense>
  );
}
