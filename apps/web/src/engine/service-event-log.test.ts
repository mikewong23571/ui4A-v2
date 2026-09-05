// T55/D76:exec 闭包内 T52 application-deprecated 选择性 refold 段的域模块测试。
// 语义取自原 service.ts exec 闭包(appendBatchWithSeq 推进水位后,仅该 kind 补折,
// seq 用日志层分配值;其余自身事件不折,防旧输入重裁决漂移)。
import { describe, expect, it } from 'vitest';

import type { EngineEvent } from '@ui4a/engine';

import { createCoreEventLogState } from './service-event-log';

function applicationDeprecatedEvent(name: string): EngineEvent {
  return {
    kind: 'application-deprecated',
    rel: `meta/application:${name}`,
    action: 'deprecate',
    actor: 'human',
    principal: 'user:mike',
    detail: { name, commandId: 'cmd:t55-refold-fixture' },
  };
}

describe('refoldApplicationDeprecations(T55 FR4.2 T52 refold 段)', () => {
  it('仅折 application-deprecated 并补上日志层分配的 seq(审计留痕)', async () => {
    const { refoldApplicationDeprecations } = await import('./service-event-log');
    const logState = createCoreEventLogState([]);
    const events: EngineEvent[] = [
      { seq: 0, kind: 'action-executed', rel: 'application:1', action: 'x' } as unknown as EngineEvent,
      applicationDeprecatedEvent('publishing'),
    ];
    refoldApplicationDeprecations(logState, events, [11, 12]);
    const audit = (logState.snapshot as unknown as Record<string, unknown>).deprecatedApplications as
      | Record<string, { name: string; seq: number }>
      | undefined;
    expect(audit?.['publishing']).toMatchObject({ name: 'publishing', seq: 12 });
  });

  it('无 deprecated 事件时不折叠(快照原样)', async () => {
    const { refoldApplicationDeprecations } = await import('./service-event-log');
    const logState = createCoreEventLogState([]);
    const snapshotBefore = logState.snapshot;
    refoldApplicationDeprecations(
      logState,
      [{ seq: 0, kind: 'action-executed', rel: 'application:1', action: 'x' } as unknown as EngineEvent],
      [11],
    );
    expect(logState.snapshot).toBe(snapshotBefore);
  });
});
