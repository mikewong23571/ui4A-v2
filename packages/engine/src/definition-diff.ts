/**
 * 机械 diff(T4 Phase C Task 1):定义 before/after 的结构化差异,纯数据。
 *
 * 铁律 5"审计渲染路径零 AI":审批者看到的 diff 由引擎在 submit 时计算
 * (deep-object-diff 的 detailedDiff 三视角),连同前后全文冻结进 activation
 * 实体与 definition-submitted 事件——渲染侧(react-diff-view,内建)只做
 * 纯数据 → 组件树,不经过被审批者提供的任何渲染器,也不依赖任何 AI。
 */
import { detailedDiff } from 'deep-object-diff';

import type { DefinitionDiff, FlowDefinition } from '@ui4a/shared';

/**
 * 计算定义的机械 diff(纯函数、确定性、JSON 可序列化)。
 * updated 视角只持新值;旧值由渲染器从 before 按同路径机械取回
 * (数字键即数组下标)。
 */
export function definitionDiff(
  before: FlowDefinition,
  after: FlowDefinition,
): DefinitionDiff {
  const { added, deleted, updated } = detailedDiff(before, after);
  return {
    algorithm: 'deep-object-diff',
    before,
    after,
    changed: {
      added: added as Record<string, unknown>,
      deleted: deleted as Record<string, unknown>,
      updated: updated as Record<string, unknown>,
    },
  };
}
