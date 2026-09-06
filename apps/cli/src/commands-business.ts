import { flagString } from './args.js';
import type { ParsedArgs } from './args.js';
import { CliError, type SuccessEnvelope } from './envelope.js';
import type { Ui4aHttpClient } from './http.js';
import {
  commandId,
  entityPath,
  envelope,
  jsonFlagOrFile,
  metaExecPath,
  record,
  writeIdentity,
} from './command-helpers.js';

function actionRows(entity: unknown): Record<string, unknown>[] {
  if (!record(entity) || !Array.isArray(entity.actions))
    throw new CliError('PROTOCOL', 'Entity has no Siren actions array', 9);
  return entity.actions.filter(record);
}

/** Client ownership comes from live Siren fields; no resource or action-name dispatch. */
function assembleActionParams(
  args: ParsedArgs,
  declaration: Record<string, unknown>,
  input: unknown,
  observed: unknown,
): { params: Record<string, unknown>; clientParams: Record<string, unknown> } {
  if (!record(input)) throw new CliError('USAGE', 'action params must be an object', 2);
  const fields = record(declaration.fields) ? declaration.fields : {};
  const properties = record(fields.properties) ? fields.properties : {};
  const clientParams: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(properties)) {
    if (!record(field) || field['x-ui4a-input-owner'] === undefined) continue;
    if (field['x-ui4a-input-owner'] !== 'client') {
      throw new CliError('PROTOCOL', 'invalid action input ownership', 9);
    }
    if (Object.hasOwn(input, name)) {
      throw new CliError('USAGE', `${name} is client-owned; use --command-id for the retry key`, 2);
    }
    if (name === 'commandId') clientParams.commandId = commandId(args);
    else if (
      name === 'baseVersion' &&
      record(observed) &&
      record(observed.properties) &&
      Number.isInteger(observed.properties.version)
    )
      clientParams.baseVersion = observed.properties.version;
    else
      throw new CliError(
        'PROTOCOL',
        `unsupported or unavailable client-owned action input: ${name}`,
        9,
      );
  }
  return { params: { ...input, ...clientParams }, clientParams };
}

async function actions(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const verb = args.words[1];
  const rel = args.words[2];
  if (rel === undefined) throw new CliError('USAGE', 'actions command requires rel', 2);
  const observed = await client.get(entityPath(rel, client.config));
  const rows = actionRows(observed.data);
  if (verb === 'list') return envelope('actions.list', rows);
  if (verb !== 'exec') throw new CliError('USAGE', 'actions supports list|exec', 2);
  const name = args.words[3];
  if (name === undefined) throw new CliError('USAGE', 'actions exec requires action name', 2);
  const declaration = rows.find((row) => row.name === name);
  if (declaration === undefined)
    throw new CliError('JUDGMENT', `action ${name} is not declared`, 6);
  const input = await jsonFlagOrFile(args, 'params', 'params-file');
  const { params, clientParams } = assembleActionParams(args, declaration, input, observed.data);
  if (
    (name === 'approve' || name === 'reject') &&
    (rel.startsWith('confirmation:') || rel.startsWith('meta/activation:'))
  ) {
    throw new CliError(
      'APPROVAL_FORBIDDEN',
      'Agent CLI cannot approve or reject human decisions',
      4,
    );
  }
  if (args.flags['dry-run'] === true) {
    return envelope('actions.exec', {
      dryRun: true,
      rel,
      action: declaration,
      params,
      effect: 'not executed',
    });
  }
  const path =
    rel.startsWith('meta/') || rel.startsWith('draft:') ? metaExecPath(client.config) : '/api/exec';
  try {
    const response = await client.post(path, writeIdentity(client, { rel, action: name, params }));
    return envelope(
      'actions.exec',
      Object.keys(clientParams).length === 0
        ? response.data
        : {
            ...(record(response.data) ? response.data : { result: response.data }),
            clientParams,
          },
    );
  } catch (error) {
    if (!(error instanceof CliError) || Object.keys(clientParams).length === 0) throw error;
    throw new CliError(
      error.code,
      error.message,
      error.exitCode,
      error.status,
      { ...(error.details === undefined ? {} : { response: error.details }), clientParams },
      error.retryable,
      error.id,
    );
  }
}

async function plans(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  if (args.words[1] !== 'submit') throw new CliError('USAGE', 'plans supports submit', 2);
  const file = flagString(args, 'file', true)!;
  const plan = await jsonFlagOrFile({ ...args, flags: { file } }, 'unused', 'file', true);
  if (!record(plan)) throw new CliError('USAGE', 'plan file must contain an object', 2);
  const response = await client.post('/api/exec-plan', writeIdentity(client, plan));
  return envelope('plans.submit', response.data);
}

export async function runBusinessCommand(
  args: ParsedArgs,
  client: Ui4aHttpClient,
): Promise<SuccessEnvelope | undefined> {
  const noun = args.words[0];
  if (noun === 'actions') return actions(args, client);
  if (noun === 'plans') return plans(args, client);
  return undefined;
}
