import Ajv from 'ajv';
import { callerActionSchema, clientActionPropertyNames, type SirenAction } from '@ui4a/engine';
import type { ExecClientResult } from '../exec-client';
import { createActionCommandIds } from './action-command-ids';

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
  commandIds?: ReturnType<typeof createActionCommandIds>;
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
  const commandIds = options.commandIds ?? createActionCommandIds();
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
    if (clientNames.includes('commandId') && typeof params.commandId === 'string') {
      params.commandId = commandIds.get(rel, action, callerParams, params.commandId);
    }
    const validateFull = validator(action.fields);
    if (!validateFull(params)) {
      return schemaFailure('参数不符合完整 action schema', validateFull.errors);
    }
    const result = await exec({
      rel,
      action: action.name,
      params: Object.keys(params).length === 0 ? undefined : params,
    });
    if (result.ok && typeof params.commandId === 'string')
      commandIds.accept(rel, action.name, params.commandId);
    return result;
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
