'use client';

import { createContext, useContext, type ReactNode } from 'react';
import Ajv from 'ajv';

import { callerActionSchema, clientActionPropertyNames, type SirenAction } from '@ui4a/engine';

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

export interface DirectActionSubmitOptions {
  /** Trusted values generated/derived by the current host after caller input is collected. */
  clientParams(input: ActionSubmitInput): Record<string, unknown>;
}

function schemaFailure(reason: string, detail?: unknown): ExecClientResult {
  return {
    ok: false,
    status: 422,
    layer: 'schema-invalid',
    reason,
    ...(detail === undefined ? {} : { detail }),
  };
}

function validator(schema: Record<string, unknown>) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addFormat('textarea', true);
  return ajv.compile(schema);
}

/** Entity/meta hosts submit to their scope-aware contract client; the server rejudges every call. */
export function createDirectActionSubmit(
  exec: ExecFn,
  options: DirectActionSubmitOptions,
): ActionSubmit {
  return async (input) => {
    const { rel, action } = input;
    let callerSchema: Record<string, unknown>;
    let clientNames: string[];
    try {
      callerSchema = callerActionSchema(action.fields);
      clientNames = clientActionPropertyNames(action.fields);
    } catch (error) {
      return schemaFailure(error instanceof Error ? error.message : String(error));
    }
    const callerParams = { ...(input.params ?? {}) };
    for (const name of clientNames) delete callerParams[name];
    const validateCaller = validator(callerSchema);
    if (!validateCaller(callerParams)) {
      return schemaFailure('参数不符合 caller action schema', validateCaller.errors);
    }
    const params = {
      ...callerParams,
      ...options.clientParams({ ...input, params: callerParams }),
    };
    const validateFull = validator(action.fields);
    if (!validateFull(params)) {
      return schemaFailure('参数不符合完整 action schema', validateFull.errors);
    }
    return exec({
      rel,
      action: action.name,
      ...(Object.keys(params).length === 0 ? {} : { params }),
    });
  };
}

/**
 * Minimal trusted-host vocabulary for D54 client-owned action fields. Unknown client annotations
 * remain missing and are rejected by full-schema validation rather than guessed.
 */
export function observedActionClientParams(
  action: SirenAction,
  observed: Record<string, unknown>,
): Record<string, unknown> {
  const names = new Set(clientActionPropertyNames(action.fields));
  const params: Record<string, unknown> = {};
  if (names.has('commandId')) params.commandId = crypto.randomUUID();
  if (names.has('baseVersion') && Number.isInteger(observed.version)) {
    params.baseVersion = observed.version;
  }
  return params;
}

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
