import { describe, expect, it } from 'vitest';

import { APP_NAME, VERSION, heartbeatMessage } from '@ui4a/shared';

import { formatHeartbeat, nextDelayMs, shutdownMessage, startupMessage } from './heartbeat';

describe('startupMessage(intervalMs)', () => {
  it('含 shared 的 APP_NAME 与 VERSION 及心跳间隔', () => {
    expect(startupMessage(3000)).toBe(
      `[${APP_NAME}] worker v${VERSION} started (heartbeat every 3000ms)`,
    );
  });
});

describe('nextDelayMs(tick, intervalMs)', () => {
  it('固定间隔策略:任意 tick 均返回 intervalMs', () => {
    expect(nextDelayMs(0, 3000)).toBe(3000);
    expect(nextDelayMs(1, 3000)).toBe(3000);
    expect(nextDelayMs(7, 3000)).toBe(3000);
  });

  it('间隔参数化,不硬编码 3000', () => {
    expect(nextDelayMs(2, 250)).toBe(250);
  });
});

describe('formatHeartbeat(tick)', () => {
  it('委托 shared 的 heartbeatMessage,格式 [ui4a] heartbeat #<tick>', () => {
    expect(formatHeartbeat(3)).toBe('[ui4a] heartbeat #3');
    expect(formatHeartbeat(1)).toBe(heartbeatMessage(1));
  });
});

describe('shutdownMessage(signal)', () => {
  it('SIGINT 与 SIGTERM 均生成退出信息', () => {
    expect(shutdownMessage('SIGINT')).toBe('[ui4a] worker received SIGINT, exiting');
    expect(shutdownMessage('SIGTERM')).toBe('[ui4a] worker received SIGTERM, exiting');
  });
});
