'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/button';

import { THREAD_ATTACH_ACTION, THREAD_DETACH_ACTION, THREAD_REL_PREFIX } from '@ui4a/engine';
import type { GuardResultEntry, SirenAction, SirenEntity } from '@ui4a/engine';

import { ReferenceSelection, referenceOptions } from './reference-selection';
import { ActionRunner } from '../action-runner';
import { ThreadMaterialAdd } from './thread-material-add';
import { useActionSubmit, type ActionSubmit } from './action-submit';

/**
 * G07 材料入口收敛:线 rel 上的合同 attach 动作(识别键 = 引擎导出的
 * THREAD_REL_PREFIX/THREAD_ATTACH_ACTION 声明,零发明字符串)在非书桌宿主
 * (首页工作线区成员卡/实体页)改走授权发现选择器主路径,与书桌同一扇门;
 * 其余动作与实体保持通用 ActionRunner,零行为改动。
 */
export function isThreadMaterialAttach(rel: string, action: SirenAction): boolean {
  return action.name === THREAD_ATTACH_ACTION.name && rel.startsWith(THREAD_REL_PREFIX);
}

/** T60 UX 评审:attach/detach 是引用(边)操作;仅线实体上的这两个动作入关系组。 */
const THREAD_REFERENCE_ACTION_NAMES = new Set([
  THREAD_ATTACH_ACTION.name,
  THREAD_DETACH_ACTION.name,
]);

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
  /** Overview hosts expose actions on demand; responsibility hosts keep them expanded. */
  posture?: 'expanded' | 'disclosure';
  /** Independent short tasks may use a modal; local reference tasks stay inline. */
  formHost?: 'inline' | 'dialog';
}

/** One contract-driven action group shared by Entity, Canvas and composition region hosts. */
export function ActionGroup({
  entity,
  rel: explicitRel,
  submit: explicitSubmit,
  onExecuted,
  density = 'default',
  posture = 'expanded',
  formHost = 'inline',
}: ActionGroupProps) {
  const submit = useActionSubmit(explicitSubmit);
  const visibleActions = entity.actions.filter((action) => referenceOptions(action)?.length !== 0);
  if (visibleActions.length === 0) return null;
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

  const confirmationActions = visibleActions.filter(
    (action) => action['requires-confirmation'] === 'high',
  );
  const normalActions = visibleActions.filter(
    (action) => action['requires-confirmation'] !== 'high',
  );
  // T60 UX 评审:线实体上的 attach/detach 先行成组披露——它们改的是本线的
  // 引用集合(边),与 pause/complete 等实体状态迁移(节点)性质不同,不该
  // 平铺在一列里;分组只调摆位,动作仍逐一经引擎声明渲染与裁决。
  const referenceActions = rel.startsWith(THREAD_REL_PREFIX)
    ? normalActions.filter((action) => THREAD_REFERENCE_ACTION_NAMES.has(action.name))
    : [];
  const primaryActions = normalActions.filter((action) => !referenceActions.includes(action));
  const renderItem = (action: SirenAction) => {
    const guard = guards.get(action.name);
    const runner =
      referenceOptions(action) !== undefined ? (
        <ReferenceSelection
          rel={rel}
          action={action}
          submit={submit}
          onExecuted={onExecuted}
          blocked={blockedForRenderer(guard)}
          blockReason={guard?.reason}
        />
      ) : isThreadMaterialAttach(rel, action) ? (
        <ThreadMaterialAdd
          rel={rel}
          action={action}
          submit={submit}
          onExecuted={onExecuted}
          blocked={blockedForRenderer(guard)}
          blockReason={guard?.reason}
        />
      ) : (
        <ActionRunner
          rel={rel}
          action={action}
          formHost={formHost}
          targetTitle={
            typeof entity.properties.identity === 'string'
              ? entity.properties.identity
              : typeof entity.properties.title === 'string'
                ? entity.properties.title
                : undefined
          }
          blocked={blockedForRenderer(guard)}
          blockReason={guard?.reason}
          onExecuted={onExecuted}
          prefill={prefill}
          submit={submit}
        />
      );
    return (
      <div
        key={`${rel}:${action.name}:${JSON.stringify([action.fields, prefill])}`}
        data-action-group-item={action.name}
      >
        {runner}
      </div>
    );
  };

  return (
    <ActionDisclosure enabled={posture === 'disclosure'}>
      <div data-testid="action-contract-group" className="space-y-3">
        {referenceActions.length > 0 && (
          <div
            data-testid="action-reference-group"
            role="group"
            aria-label="关联"
            className="flex flex-wrap items-center gap-2"
          >
            {referenceActions.map(renderItem)}
          </div>
        )}
        <div className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-3'}>
          {primaryActions.map(renderItem)}
          {confirmationActions.length > 0 && (
            <div
              data-testid="action-confirmation-group"
              aria-label="需要确认的操作"
              className={
                compact
                  ? 'flex flex-wrap items-center gap-2'
                  : 'space-y-3 border-t border-dashed pt-3'
              }
            >
              {confirmationActions.map(renderItem)}
            </div>
          )}
        </div>
      </div>
    </ActionDisclosure>
  );
}

function ActionDisclosure({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  if (!enabled) return <>{children}</>;
  return (
    <div
      onKeyDown={(event) => {
        if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
        if (event.key === 'Escape' && open && !event.defaultPrevented) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        data-nav="presentation:expand-actions"
        onClick={() => setOpen(!open)}
      >
        更多操作
      </Button>
      <div id={id} hidden={!open} className="pt-2">
        {children}
      </div>
    </div>
  );
}
