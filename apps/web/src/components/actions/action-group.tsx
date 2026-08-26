'use client';

import type { GuardResultEntry, SirenEntity } from '@ui4a/engine';

import { ActionRunner } from '../action-runner';
import { useActionSubmit, type ActionSubmit } from './action-submit';

export const ACTION_CONTRACT_LEGEND = '你和助手使用同一合同，由同一规则裁决';

/** Human renderer satisfies actor-is-human; all other failed guards remain visibly blocked. */
export function blockedForRenderer(entry: GuardResultEntry | undefined): boolean {
  if (entry?.blocked !== true) return false;
  const failed = entry.guards.filter((evaluation) => !evaluation.pass);
  if (failed.length === 0) return true;
  return !failed.every((evaluation) => evaluation.name === 'actor-is-human');
}

export interface ActionGroupProps {
  entity: SirenEntity;
  /** Page aliases/audit entities may supply their exact contract target outside properties. */
  rel?: string;
  submit?: ActionSubmit;
  onExecuted?: (rel: string) => void;
}

/** One contract-driven action group shared by Entity, Canvas and composition region hosts. */
export function ActionGroup({
  entity,
  rel: explicitRel,
  submit: explicitSubmit,
  onExecuted,
}: ActionGroupProps) {
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

  return (
    <div data-testid="action-contract-group" className="space-y-3">
      <p className="text-xs text-muted-foreground">{ACTION_CONTRACT_LEGEND}</p>
      <div className="space-y-3">
        {entity.actions.map((action) => {
          const guard = guards.get(action.name);
          return (
            <div
              key={`${rel}:${action.name}:${JSON.stringify(action.fields)}`}
              data-action-group-item={action.name}
              className="rounded-md border bg-card p-3"
            >
              <ActionRunner
                rel={rel}
                action={action}
                blocked={blockedForRenderer(guard)}
                blockReason={guard?.reason}
                onExecuted={onExecuted}
                prefill={prefill}
                submit={submit}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
