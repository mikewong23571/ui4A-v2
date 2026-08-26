'use client';
/**
 * form 词条(T7 Phase B / 选型 §6):复用 ActionGroup/ActionRunner(RJSF v6)。
 *
 * - entity = 实体引用的解引用结果;字段 schema 从实体 actions 生成
 *   (零硬编码字段——字段集完全由合同声明);
 * - guard-results 的 blocked 投影为 disabled(entity-view 同口径);
 * - 铁律 3:每个 form/button 带 data-action=<已声明动作名>,提交走
 *   /api/exec(渲染层白名单,合同外按钮无法提交)。
 */
import { ActionGroup } from '../../components/action-group';

import { asEntity, asRequiredString, type WordProps } from './shared';

export function FormWord(props: WordProps) {
  const entity = asEntity(props.entity, 'form', 'entity');
  // exec 提交目标 = 实体自身 rel(引擎口径:动作落在实例 rel 上)。
  asRequiredString(entity.properties.rel, 'form', 'entity.rel');

  if (entity.actions.length === 0) {
    return (
      <p data-word="form" className="text-sm text-muted-foreground">
        该实体无已声明动作(零可提交元素)。
      </p>
    );
  }

  return (
    <section data-word="form" className="space-y-4">
      <ActionGroup entity={entity} />
    </section>
  );
}
