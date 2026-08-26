'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { SirenAction } from '@ui4a/engine';

import { createSurfaceActionAdapter } from '@/render/presentation/action-adapter';
import type {
  SurfaceActionAdapterDependencies,
  SurfaceActionOutcome,
} from '@/render/presentation/action-adapter';

import type { ExecClientResult } from '../exec-client';

export type ExecFn = (input: {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
}) => Promise<ExecClientResult>;

export interface ActionSubmitInput {
  rel: string;
  action: SirenAction;
  params?: Record<string, unknown>;
}

/** Explicit host-owned submit boundary for one current Siren action declaration. */
export type ActionSubmit = (input: ActionSubmitInput) => Promise<ExecClientResult>;

/** Entity/meta hosts submit to their scope-aware contract client; the server rejudges every call. */
export function createDirectActionSubmit(exec: ExecFn): ActionSubmit {
  return ({ rel, action, params }) => exec({ rel, action: action.name, params });
}

function outcomeResult(outcome: SurfaceActionOutcome): ExecClientResult {
  return outcome.outcome === 'executed'
    ? { ok: true, entity: outcome.entity }
    : {
        ok: false,
        status: outcome.status ?? 409,
        layer: outcome.code,
        reason: outcome.reason,
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
