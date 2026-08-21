import { describe, expect, it } from 'vitest';

import { APP_NAME, VERSION } from '@ui4a/shared';

import { shutdownBanner, startupBanner } from './banner';

// worker 启动/退出横幅(T3 Phase C:心跳循环改为启动横幅,VERSION 证明 shared 通路)。
describe('startupBanner({taskQueue, address})', () => {
  it('含 shared 的 APP_NAME 与 VERSION、taskQueue 与 Temporal 地址', () => {
    expect(startupBanner({ taskQueue: 'ui4a', address: 'localhost:7233' })).toBe(
      `[${APP_NAME}] worker v${VERSION} started (taskQueue=ui4a, temporal=localhost:7233)`,
    );
  });

  it('地址参数化(TEMPORAL_ADDRESS 可指向远端)', () => {
    expect(startupBanner({ taskQueue: 'ui4a', address: 'temporal.prod:7233' })).toContain(
      'temporal=temporal.prod:7233',
    );
  });
});

describe('shutdownBanner(signal)', () => {
  it('SIGINT 与 SIGTERM 均生成优雅退出信息', () => {
    expect(shutdownBanner('SIGINT')).toBe('[ui4a] worker received SIGINT, shutting down');
    expect(shutdownBanner('SIGTERM')).toBe('[ui4a] worker received SIGTERM, shutting down');
  });
});
