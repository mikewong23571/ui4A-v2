import { describe, expect, it } from 'vitest';

import { APP_NAME, VERSION } from '@ui4a/shared';

// 断言 apps/web 能通过 workspace 协议导入 @ui4a/shared(全栈共享通路的地基验证)。
describe('apps/web 对 @ui4a/shared 的引用通路', () => {
  it('APP_NAME 可导入且为 "UI4A"', () => {
    expect(APP_NAME).toBe('UI4A');
  });

  it('VERSION 可导入且为 canonical experimental semver', () => {
    expect(VERSION).toBe('0.1.0-experimental.1');
  });
});
