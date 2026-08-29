'use client';

import { createContext, useContext } from 'react';

import type { GuardResultEntry, SirenEntity } from '@ui4a/engine';

import { ActionRunner } from '../action-runner';
import { useActionSubmit, type ActionSubmit } from './action-submit';

export const ACTION_CONTRACT_LEGEND = '你和助手使用同一合同，由同一规则裁决';

/**
 * T35 F-06:合同图例每个 surface 只渲染一次——外层 ActionGroup 展示后向内层
 * 传播已展示标记;纯呈现层协调,零业务事件。
 */
const ActionLegendContext = createContext(false);

/** Human renderer satisfies actor-is-human; all other failed guards remain visibly blocked. */
export function blockedForRenderer(entry: GuardResultEntry | undefined): boolean {
  if (entry?.blocked !== true) return false;
  const failed = entry.guards.filter((evaluation) => !evaluation.pass);
  if (failed.length === 0) return true;
  return !failed.every((evaluation) => evaluation.name === 'actor-is-human');
}

/** 动作组密度:default 决策卡全宽盒子;compact 行内排列(member-table 操作列等)。 */
export type ActionGroupDensity = 'default' | 'compact';

export interface ActionGroupProps {
  entity: SirenEntity;
  /** Page aliases/audit entities may supply their exact contract target outside properties. */
  rel?: string;
  submit?: ActionSubmit;
  onExecuted?: (rel: string) => void;
  /** 缺省 'default',既有行为零变化;compact 供表格行内动作列等窄空间复用。 */
  density?: ActionGroupDensity;
}

/** One contract-driven action group shared by Entity, Canvas and composition region hosts. */
export function ActionGroup({
  entity,
  rel: explicitRel,
  submit: explicitSubmit,
  onExecuted,
  density = 'default',
}: ActionGroupProps) {
  const legendShown = useContext(ActionLegendContext);
  const submit = useActionSubmit(explicitSubmit);
  if (entity.actions.length === 0) return null;
  if (submit === undefined) throw new Error('ActionGroup requires an explicit host submit adapter');
  const rel = entity.properties.rel ?? explicitRel;
  if (typeof rel !== 'string' || rel === '') {
    throw new Error('ActionGroup entity requires a canonical properties.rel');
  }
  const guards = new Map((entity['guard-results'] ?? []).map((entry) => [entry.action, entry]));
  const prefill =
    typeof entity.properties.fields === 'object' && entity.properties.fields !== null
      ? (entity.properties.fields as Record<string, unknown>)
      : undefined;
  const compact = density === 'compact';

  // T35 F-07/§十:动作语义分层——危险组按合同声明 requires-confirmation 派生
  // (通用机制,零实体特判),与常规组分隔呈现,不可逆操作不再与普通操作同级。
  const dangerActions = entity.actions.filter(
    (action) => action['requires-confirmation'] === 'high',
  );
  const normalActions = entity.actions.filter(
    (action) => action['requires-confirmation'] !== 'high',
  );
  const renderItem = (action: (typeof entity.actions)[number], tone: 'normal' | 'danger') => {
    const guard = guards.get(action.name);
    const runner = (
      <ActionRunner
        rel={rel}
        action={action}
        tone={tone === 'danger' ? 'danger' : undefined}
        blocked={blockedForRenderer(guard)}
        blockReason={guard?.reason}
        onExecuted={onExecuted}
        prefill={prefill}
        submit={submit}
      />
    );
    if (compact) {
      // compact:行内动作条目,不再套全宽边框盒子;钩子与裁决语义零变化。
      return (
        <div
          key={`${rel}:${action.name}:${JSON.stringify(action.fields)}`}
          data-action-group-item={action.name}
        >
          {runner}
        </div>
      );
    }
    return (
      <div
        key={`${rel}:${action.name}:${JSON.stringify(action.fields)}`}
        data-action-group-item={action.name}
        className={
          tone === 'danger'
            ? 'rounded-md border border-destructive/40 bg-card p-3'
            : 'rounded-md border bg-card p-3'
        }
      >
        {runner}
      </div>
    );
  };

  return (
    <div data-testid="action-contract-group" className="space-y-3">
      {legendShown || compact ? null : (
        <p data-testid="action-contract-legend" className="text-xs text-muted-foreground">
          {ACTION_CONTRACT_LEGEND}
        </p>
      )}
      {/* 图例已展示标记只在真的渲染过图例时向内传播;compact 自身不披露图例,
          内层 default 组仍要补披露(披露保留在详情面)。 */}
      <ActionLegendContext.Provider value={compact ? legendShown : true}>
        <div className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-3'}>
          {normalActions.map((action) => renderItem(action, 'normal'))}
          {dangerActions.length > 0 && (
            <div
              data-testid="action-danger-group"
              aria-label="危险操作"
              className={
                compact
                  ? // compact:危险动作与常规动作同行,仅以 destructive tone 区分
                    // (两步确认语义在 ActionRunner 内不变);分隔线属 default 密度。
                    'flex flex-wrap items-center gap-2'
                  : 'space-y-3 border-t border-dashed pt-3'
              }
            >
              {dangerActions.map((action) => renderItem(action, 'danger'))}
            </div>
          )}
        </div>
      </ActionLegendContext.Provider>
    </div>
  );
}
