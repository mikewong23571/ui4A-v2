import { describe, expect, it } from 'vitest';

import { APP_NAME, VERSION, heartbeatMessage } from './index';

describe('@ui4a/shared 占位导出', () => {
  it('APP_NAME 为 "UI4A"', () => {
    expect(APP_NAME).toBe('UI4A');
  });

  it('VERSION 为 canonical experimental semver', () => {
    expect(VERSION).toBe('0.1.0-experimental.1');
  });
});

describe('heartbeatMessage(tick)', () => {
  it('返回 `[ui4a] heartbeat #<tick>` 格式', () => {
    expect(heartbeatMessage(3)).toBe('[ui4a] heartbeat #3');
  });

  it('tick=1 与首次心跳格式一致', () => {
    expect(heartbeatMessage(1)).toBe('[ui4a] heartbeat #1');
  });

  it('tick=0 不抛错且格式保持一致', () => {
    expect(heartbeatMessage(0)).toBe('[ui4a] heartbeat #0');
  });
});
