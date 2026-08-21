'use client';
/**
 * diff 词条(T7 Phase B / 选型 §6):复用内建机械 diff 渲染(react-diff-view)。
 *
 * - entity = 实体引用的解引用结果;diff 载荷(properties.diff)是引擎在
 *   submit 时冻结的结构化数据(DefinitionDiff 形状);
 * - 渲染路径零 AI(铁律 5):-/+ 行从 before/after 全文按路径机械取回。
 */
import type { DefinitionDiff } from '@ui4a/engine';

import { DefinitionDiffView } from '../../components/meta/diff-render';

import { asEntity, type WordProps } from './shared';

/** diff 载荷最小形状校验(before/after/changed 三件;算法字段保留直传)。 */
function diffPayload(entity: ReturnType<typeof asEntity>): DefinitionDiff {
  const diff = entity.properties.diff;
  if (
    typeof diff !== 'object' ||
    diff === null ||
    Array.isArray(diff) ||
    typeof (diff as Record<string, unknown>).before !== 'object' ||
    typeof (diff as Record<string, unknown>).after !== 'object' ||
    typeof (diff as Record<string, unknown>).changed !== 'object'
  ) {
    throw new Error('词条 diff 的 entity 缺机械 diff 载荷(properties.diff{before,after,changed})');
  }
  return diff as DefinitionDiff;
}

export function DiffWord(props: WordProps) {
  const entity = asEntity(props.entity, 'diff', 'entity');
  return <div data-word="diff"><DefinitionDiffView diff={diffPayload(entity)} /></div>;
}
