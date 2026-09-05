/**
 * T56 P2.2:助手并排/覆盖的剩余宽度判定单测(D78 决定 1/design §1 几何契约;
 * px 契约的组件级锚点,浏览器 bounding box 归 E2E work-thread-workspace)。
 *
 * 阈值基线 = probes/s3-layout-session.md §1.2(D78 已登记):
 * - 助手 384px → 并排阈值视口 1072(1080 通过、1024 不通过);
 * - 助手 320px → 并排阈值 1008;
 * - 200% 缩放(布局视口 960 CSS px)任何助手宽度都必须覆盖;
 * - 60% 占比条件独立生效(主区净宽 ≥640 但占比不足仍覆盖)。
 */
import { describe, expect, it } from 'vitest';

import {
  assistantDockDecision,
  DOCK_MIN_MAIN_WIDTH_PX,
  SHELL_HORIZONTAL_PADDING_PX,
} from './layout-decision';

describe('assistantDockDecision(D78 剩余宽度判定)', () => {
  it('1072 是 384px 助手的并排边界:1072 并排、1071 覆盖(S3 实测 1080 通过)', () => {
    expect(assistantDockDecision(1072)).toBe('side-by-side');
    expect(assistantDockDecision(1071)).toBe('overlay');
    expect(assistantDockDecision(1080)).toBe('side-by-side');
  });

  it('1024 整屏断点不并排(D78:禁仅整屏 lg: 的内层断点)', () => {
    expect(assistantDockDecision(1024)).toBe('overlay');
  });

  it('助手收窄到 320px → 并排阈值 1008:1008 并排、1007 覆盖', () => {
    expect(assistantDockDecision(1008, 320)).toBe('side-by-side');
    expect(assistantDockDecision(1007, 320)).toBe('overlay');
  });

  it('200% 缩放(布局视口 960)任何助手宽度都必须覆盖', () => {
    expect(assistantDockDecision(960)).toBe('overlay');
    expect(assistantDockDecision(960, 320)).toBe('overlay');
  });

  it('六视口基线:1440/1280/1080 并排,768/390 覆盖(US05 验证视口)', () => {
    expect(assistantDockDecision(1440)).toBe('side-by-side');
    expect(assistantDockDecision(1280)).toBe('side-by-side');
    expect(assistantDockDecision(1080)).toBe('side-by-side');
    expect(assistantDockDecision(768)).toBe('overlay');
    expect(assistantDockDecision(390)).toBe('overlay');
  });

  it('60% 占比独立生效:主区净宽 ≥640 但占比不足仍覆盖', () => {
    // 1440−48−700 = 692 ≥ 640,但 692/(692+700) ≈ 0.497 < 0.6。
    expect(assistantDockDecision(1440, 700)).toBe('overlay');
    // 1264−48−560 = 656 ≥ 640,但 656/1216 ≈ 0.539 < 0.6。
    expect(assistantDockDecision(1264, 560)).toBe('overlay');
  });

  it('并排时主区净宽恰为绑定下限 640(vw−48−助手宽)', () => {
    const assistantWidth = 384;
    const threshold = DOCK_MIN_MAIN_WIDTH_PX + SHELL_HORIZONTAL_PADDING_PX + assistantWidth;
    expect(assistantDockDecision(threshold, assistantWidth)).toBe('side-by-side');
    expect(threshold - 1).toBe(1071);
    expect(assistantDockDecision(threshold - 1, assistantWidth)).toBe('overlay');
  });
});
