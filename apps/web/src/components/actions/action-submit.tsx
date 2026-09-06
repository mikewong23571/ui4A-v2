'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { createSurfaceActionAdapter } from '@/render/presentation/action-adapter';
import type {
  SurfaceActionAdapterDependencies,
  SurfaceActionOutcome,
} from '@/render/presentation/action-adapter';

import type { ExecClientResult } from '../exec-client';
import { createActionCommandIds } from './action-command-ids';

export { createDirectActionSubmit, observedActionClientParams } from './action-client-submit';
export type {
  ActionSubmit,
  ActionSubmitInput,
  DirectActionSubmitOptions,
  ExecFn,
} from './action-client-submit';
import type { ActionSubmit } from './action-client-submit';

function outcomeResult(outcome: SurfaceActionOutcome): ExecClientResult {
  return outcome.outcome === 'executed'
    ? {
        ok: true,
        entity: outcome.entity,
        ...(outcome.subjectEntity !== undefined ? { subject: outcome.subjectEntity } : {}),
      }
    : {
        ok: false,
        status: outcome.status ?? 409,
        layer: outcome.code,
        reason: outcome.reason,
        ...(outcome.confirmation === undefined ? {} : { confirmation: outcome.confirmation }),
      };
}

/** Surface hosts add a fresh declaration/guard/schema/dependency check before server judgment. */
export function createSurfaceActionSubmit(
  dependencies: SurfaceActionAdapterDependencies,
): ActionSubmit {
  const adapter = createSurfaceActionAdapter(dependencies);
  return async ({ rel, action, params }) =>
    outcomeResult(
      await adapter.submit({
        subject: rel,
        action: action.name,
        params,
        expected: { actionSchema: action.fields },
      }),
    );
}

const ActionSubmitContext = createContext<ActionSubmit | undefined>(undefined);

export function ActionSubmitProvider({
  submit,
  children,
}: {
  submit: ActionSubmit;
  children: ReactNode;
}) {
  return <ActionSubmitContext.Provider value={submit}>{children}</ActionSubmitContext.Provider>;
}

/** Action groups may receive an explicit page adapter or consume the nearest Surface host. */
export function useActionSubmit(explicit?: ActionSubmit): ActionSubmit | undefined {
  const contextual = useContext(ActionSubmitContext);
  return explicit ?? contextual;
}

/** Keep retry identity through host rerenders without retaining authority or a global cache. */
export function useActionCommandIds() {
  const [commandIds] = useState(createActionCommandIds);
  return commandIds;
}
