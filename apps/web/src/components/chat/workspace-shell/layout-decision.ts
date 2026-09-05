'use client';
/**
 * T56 D78 决定 1:助手并排/覆盖的剩余宽度判定单点(纯函数)+ 视口宽度订阅。
 *
 * 并排条件(S3 六视口 DOM 实测定案,已入 DECISIONS D78):扣除全局壳水平
 * padding(48px)与助手宽度后,主工作面 ≥640 CSS px 且 ≥两栏净宽的 60%
 * (≥640 时 60% 条件恒满足 62.5%,640 是绑定约束)。按剩余宽度计算,不使用
 * 仅整屏 `lg:` 的内层断点:助手 384px → 并排阈值视口 1072(1080 通过、
 * 1024 不通过);收窄到 320px → 1008;200% 缩放(布局视口 960)必须覆盖/单面。
 *
 * 判定只决定呈现形态,不触碰会话宿主(useChatSession 挂壳,形态切换不重建);
 * 布局状态属当次用户选择,切 focus/新状态不强制重新停靠。
 */
import { useEffect, useState } from 'react';

/** 全局壳水平 padding 合计(main 的 px-6 两侧)。 */
export const SHELL_HORIZONTAL_PADDING_PX = 48;
/** 并排时主工作面的最小可读宽度(D78:640 是绑定约束,不是手机最小宽)。 */
export const DOCK_MIN_MAIN_WIDTH_PX = 640;
/** 并排时主区占两栏净宽的最小占比(D78:60%)。 */
export const DOCK_MIN_MAIN_RATIO = 0.6;
/** 并排停靠形态的助手栏宽度(w-96)。 */
export const ASSISTANT_DOCK_WIDTH_PX = 384;

/** 助手呈现形态:并排停靠(主区让宽)或覆盖悬浮(不挤压主区)。 */
export type AssistantLayout = 'side-by-side' | 'overlay';

/**
 * 剩余宽度并排判定(D78 单点):视口宽 − 全局 padding − 助手宽 ≥ 640 且
 * 占两栏净宽 ≥ 60% 时并排,否则覆盖。宽度按实际声明宽度参与计算(320–384
 * 皆可,阈值随宽度移动),不做整屏断点特判。
 */
export function assistantDockDecision(
  viewportWidth: number,
  assistantWidth: number = ASSISTANT_DOCK_WIDTH_PX,
): AssistantLayout {
  const mainWidth = viewportWidth - SHELL_HORIZONTAL_PADDING_PX - assistantWidth;
  if (mainWidth < DOCK_MIN_MAIN_WIDTH_PX) return 'overlay';
  return mainWidth / (mainWidth + assistantWidth) >= DOCK_MIN_MAIN_RATIO
    ? 'side-by-side'
    : 'overlay';
}

/**
 * 视口宽度订阅:窗口/缩放变化时驱动形态重判(覆盖 ⇄ 并排就地切换,会话
 * 不受影响)。SSR/首帧返回 0(仅覆盖形态可达,宿主未展开时宽度不参与渲染)。
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    const sync = (): void => setWidth(window.innerWidth);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  return width;
}
