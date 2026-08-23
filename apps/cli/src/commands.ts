import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ParsedArgs } from './args.js';
import { flagNumber, flagString } from './args.js';
import type { CliConfig } from './config.js';
import { CLI_VERSION, CliError, success, type SuccessEnvelope } from './envelope.js';
import { Ui4aHttpClient } from './http.js';

export const HELP = `ui4a ${CLI_VERSION} — UI4A HTTP/Siren/meta reference client

Usage: ui4a [--json] [--base-url URL] <noun> <verb> [arguments]

Discover and read:
  doctor                              Check endpoint, protocol and auth source
  apps list | apps show <name>        Discover authorized Applications
  flows list | flows show <name>      Discover active Flows
  entities get|resolve <rel>           Read exact Siren Entity and live actions
  catalog list                         Read registered capabilities
  audit <session|entity|definition|draft> <id> [--after-seq N] [--limit N]

Business operations:
  actions list <rel>
  actions exec <rel> <action> --params JSON|--params-file FILE [--dry-run]
  plans submit --file FILE

Definition Bundles and governed Drafts:
  bundles export <application> [--out FILE]
  bundles validate --file FILE
  bundles diff --before FILE --after FILE
  drafts create --kind flow-definition --target FLOW --payload-file FILE [--command-id ID]
  drafts get|diff|validate|submit|abandon <draft-id> [options]
  drafts list [--status STATUS] [--limit N]
  drafts revise <draft-id> --base-version N --payload-file FILE [--target-base-version N]
  drafts watch <draft-id> [--after-seq N]
  activations get|watch <activation-rel>

Read-only escape hatch:
  request get|head <same-origin-path>

Safety: the CLI has no LLM, approve/reject command, --actor, --principal, --no-draft, or raw write.
Identity is credential-derived in production. Current local demo is explicitly self-reported.
`;

interface Sitemap {
  protocolVersion?: string;
  version?: string;
  applications?: Record<string, unknown>[];
  flows?: Record<string, unknown>[];
  capabilities?: Record<string, unknown>[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dataOf(response: { data: unknown }): Record<string, unknown> {
  if (!record(response.data)) throw new CliError('PROTOCOL', 'expected JSON object', 9);
  return response.data;
}

function commandId(args: ParsedArgs): string {
  return flagString(args, 'command-id') ?? randomUUID();
}

async function jsonFlagOrFile(
  args: ParsedArgs,
  inline: string,
  file: string,
  required = false,
): Promise<unknown> {
  const raw = flagString(args, inline);
  const path = flagString(args, file);
  if (raw !== undefined && path !== undefined)
    throw new CliError('USAGE', `use only --${inline} or --${file}`, 2);
  if (raw === undefined && path === undefined) {
    if (required) throw new CliError('USAGE', `--${inline} or --${file} is required`, 2);
    return {};
  }
  try {
    return JSON.parse(raw ?? (await readFile(resolve(path!), 'utf8')));
  } catch (error) {
    throw new CliError(
      'USAGE',
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}

function entityPath(rel: string, config: CliConfig): string {
  const meta = rel.startsWith('meta/') || rel.startsWith('draft:');
  const base = meta ? '/_meta/api/entity' : '/api/entity';
  const query = new URLSearchParams({ rel });
  if (meta) query.set('policyScope', config.policyScope);
  return `${base}?${query}`;
}

async function sitemap(client: Ui4aHttpClient): Promise<Sitemap> {
  return dataOf(await client.get('/.well-known/ui4a.json')) as Sitemap;
}

function envelope(
  command: string,
  data: unknown,
  protocolVersion?: string,
  page?: { nextCursor: string | number | null; hasMore?: boolean },
): SuccessEnvelope {
  return success(command, data, {
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    ...(page === undefined ? {} : { page }),
  });
}

async function doctor(client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const probes: Record<string, unknown> = {};
  let protocolVersion: string | undefined;
  for (const [name, path] of [
    ['health', '/api/health'],
    ['business', '/.well-known/ui4a.json'],
    ['meta', '/_meta/.well-known/ui4a.json'],
  ]) {
    try {
      const result = await client.get(path);
      probes[name] = { reachable: true, status: result.status };
      if (record(result.data) && typeof result.data.protocolVersion === 'string')
        protocolVersion = result.data.protocolVersion;
    } catch (error) {
      probes[name] = {
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (Object.values(probes).every((probe) => record(probe) && probe.reachable === false)) {
    throw new CliError(
      'NETWORK',
      'UI4A endpoint is unreachable',
      8,
      undefined,
      { endpoint: client.config.baseUrl, probes },
      true,
    );
  }
  return envelope(
    'doctor',
    {
      cliVersion: CLI_VERSION,
      endpoint: client.config.baseUrl,
      auth: {
        mode: client.config.token === undefined ? 'self-reported-local-demo' : 'bearer',
        source: client.config.sources.token,
        configured: client.config.token !== undefined,
      },
      principalSource: client.config.sources.principal,
      policyScope: client.config.policyScope,
      probes,
      missing: client.config.token === undefined ? ['UI4A_TOKEN (optional in local demo)'] : [],
    },
    protocolVersion,
  );
}

async function apps(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const map = await sitemap(client);
  const verb = args.words[1];
  if (verb === 'list') return envelope('apps.list', map.applications ?? [], map.protocolVersion);
  if (verb === 'show') {
    const name = args.words[2];
    if (name === undefined) throw new CliError('USAGE', 'apps show requires a name', 2);
    const found = (map.applications ?? []).find((row) => row.name === name);
    if (found === undefined)
      throw new CliError('NOT_FOUND', `application ${name} not found`, 5, 404);
    return envelope('apps.show', found, map.protocolVersion);
  }
  throw new CliError('USAGE', 'apps supports list|show', 2);
}

async function flows(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const map = await sitemap(client);
  const verb = args.words[1];
  if (verb === 'list') return envelope('flows.list', map.flows ?? [], map.protocolVersion);
  if (verb === 'show') {
    const name = args.words[2];
    if (name === undefined) throw new CliError('USAGE', 'flows show requires a name', 2);
    const found = (map.flows ?? []).find((row) => row.name === name);
    if (found === undefined) throw new CliError('NOT_FOUND', `flow ${name} not found`, 5, 404);
    return envelope('flows.show', found, map.protocolVersion);
  }
  throw new CliError('USAGE', 'flows supports list|show', 2);
}

async function entities(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const verb = args.words[1];
  const rel = args.words[2];
  if (!['get', 'resolve'].includes(verb ?? '') || rel === undefined)
    throw new CliError('USAGE', 'entities get|resolve requires rel', 2);
  const response = await client.get(entityPath(rel, client.config));
  return envelope(`entities.${verb}`, response.data);
}

async function catalog(client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const map = await sitemap(client);
  return envelope('catalog.list', map.capabilities ?? [], map.protocolVersion);
}

function actionRows(entity: unknown): Record<string, unknown>[] {
  if (!record(entity) || !Array.isArray(entity.actions))
    throw new CliError('PROTOCOL', 'Entity has no Siren actions array', 9);
  return entity.actions.filter(record);
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
  const params = await jsonFlagOrFile(args, 'params', 'params-file');
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
    rel.startsWith('meta/') || rel.startsWith('draft:') ? '/_meta/api/exec' : '/api/exec';
  const response = await client.post(path, {
    rel,
    action: name,
    params,
    actor: 'agent',
    principal: client.config.principal,
    channel: 'cli',
  });
  return envelope('actions.exec', response.data);
}

async function plans(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  if (args.words[1] !== 'submit') throw new CliError('USAGE', 'plans supports submit', 2);
  const file = flagString(args, 'file', true)!;
  const plan = await jsonFlagOrFile({ ...args, flags: { file } }, 'unused', 'file', true);
  if (!record(plan)) throw new CliError('USAGE', 'plan file must contain an object', 2);
  const response = await client.post('/api/exec-plan', {
    ...plan,
    actor: 'agent',
    principal: client.config.principal,
    channel: 'cli',
  });
  return envelope('plans.submit', response.data);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function definitionBundle(value: unknown): Record<string, unknown> {
  if (!record(value) || value.schema !== 'https://ui4a.dev/application-definition-bundle/v1')
    throw new CliError('SCHEMA', 'unsupported definition Bundle schema', 6);
  for (const key of ['bundle', 'applications', 'capabilities', 'flows', 'policies', 'provenance']) {
    if (!(key in value)) throw new CliError('SCHEMA', `definition Bundle missing ${key}`, 6);
  }
  return value;
}

function structuralDiff(before: unknown, after: unknown, path = ''): Record<string, unknown>[] {
  if (canonical(before) === canonical(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) =>
      structuralDiff(before[index], after[index], `${path}/${index}`),
    ).flat();
  }
  if (record(before) && record(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) => structuralDiff(before[key], after[key], `${path}/${key}`));
  }
  return [{ path: path || '/', before: before ?? null, after: after ?? null }];
}

async function bundles(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const verb = args.words[1];
  if (verb === 'export') {
    const name = args.words[2];
    if (name === undefined) throw new CliError('USAGE', 'bundles export requires application', 2);
    const response = await client.get(entityPath(`meta/application:${name}`, client.config));
    const entity = dataOf(response);
    const properties = record(entity.properties) ? entity.properties : {};
    const bundle = definitionBundle(properties.bundle);
    const output = flagString(args, 'out');
    if (output !== undefined)
      await writeFile(resolve(output), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    return envelope('bundles.export', {
      bundle,
      ...(output === undefined
        ? {}
        : { path: resolve(output), bytes: Buffer.byteLength(JSON.stringify(bundle)) }),
    });
  }
  if (verb === 'validate') {
    const file = flagString(args, 'file', true)!;
    const parsed = definitionBundle(JSON.parse(await readFile(resolve(file), 'utf8')) as unknown);
    return envelope('bundles.validate', {
      valid: true,
      hash: `sha256:${createHash('sha256').update(canonical(parsed)).digest('hex')}`,
      bundle: parsed.bundle,
    });
  }
  if (verb === 'diff') {
    const beforePath = flagString(args, 'before', true)!;
    const afterPath = flagString(args, 'after', true)!;
    const before = definitionBundle(
      JSON.parse(await readFile(resolve(beforePath), 'utf8')) as unknown,
    );
    const after = definitionBundle(
      JSON.parse(await readFile(resolve(afterPath), 'utf8')) as unknown,
    );
    const changes = structuralDiff(before, after);
    return envelope('bundles.diff', {
      changed: changes.length > 0,
      changes,
      hash: `sha256:${createHash('sha256').update(canonical(changes)).digest('hex')}`,
    });
  }
  throw new CliError('USAGE', 'bundles supports export|validate|diff', 2);
}

function draftRel(value: string): string {
  return value.startsWith('draft:') ? value : `draft:${value}`;
}

async function draftExec(client: Ui4aHttpClient, rel: string, actionName: string, params: unknown) {
  return client.post('/_meta/api/exec', {
    rel,
    action: actionName,
    params,
    actor: 'agent',
    principal: client.config.principal,
    channel: 'cli',
  });
}

async function drafts(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const verb = args.words[1];
  if (verb === 'list') {
    const response = await client.get(entityPath('meta/drafts', client.config));
    const entity = dataOf(response);
    const rows = Array.isArray(entity.entities) ? entity.entities : [];
    const status = flagString(args, 'status');
    const limit = Math.min(flagNumber(args, 'limit', 20)!, 100);
    const filtered = rows
      .filter(
        (row) =>
          status === undefined ||
          (record(row) && record(row.properties) && row.properties.status === status),
      )
      .slice(0, limit);
    return envelope('drafts.list', filtered, undefined, {
      nextCursor: null,
      hasMore: rows.length > filtered.length,
    });
  }
  if (verb === 'create') {
    const payload = await jsonFlagOrFile(args, 'payload', 'payload-file', true);
    const response = await draftExec(client, 'meta/drafts', 'create', {
      kind: flagString(args, 'kind', true),
      target: flagString(args, 'target', true),
      policyScope: client.config.policyScope,
      commandId: commandId(args),
      payload,
    });
    return envelope('drafts.create', response.data);
  }
  const id = args.words[2];
  if (id === undefined) throw new CliError('USAGE', `drafts ${verb ?? ''} requires draft id`, 2);
  const rel = draftRel(id);
  if (verb === 'get' || verb === 'diff') {
    const response = await client.get(entityPath(rel, client.config));
    return envelope(
      `drafts.${verb}`,
      verb === 'diff' && record(response.data) && record(response.data.properties)
        ? response.data.properties.diff
        : response.data,
    );
  }
  if (verb === 'watch') {
    const after = flagNumber(args, 'after-seq', 0)!;
    const response = await client.get(
      `/api/events?${new URLSearchParams({ domain: 'draft', rel, afterSeq: String(after), limit: String(Math.min(flagNumber(args, 'limit', 20)!, 100)) })}`,
    );
    const body = dataOf(response);
    return envelope(
      'drafts.watch',
      body.events ?? [],
      undefined,
      record(body.page)
        ? {
            nextCursor: (body.page.nextAfterSeq as string | number | null) ?? null,
            hasMore: body.page.hasMore as boolean | undefined,
          }
        : undefined,
    );
  }
  const idempotency = commandId(args);
  if (verb === 'revise') {
    const payload = await jsonFlagOrFile(args, 'payload', 'payload-file', true);
    const response = await draftExec(client, rel, 'revise', {
      commandId: idempotency,
      baseVersion:
        flagNumber(args, 'base-version') ??
        (() => {
          throw new CliError('USAGE', '--base-version is required', 2);
        })(),
      ...(flagString(args, 'target-base-version') === undefined
        ? {}
        : { targetBaseVersion: flagString(args, 'target-base-version') }),
      payload,
    });
    return envelope('drafts.revise', response.data);
  }
  if (!['validate', 'submit', 'abandon'].includes(verb ?? ''))
    throw new CliError(
      'USAGE',
      'drafts supports create|get|list|revise|validate|diff|submit|watch|abandon',
      2,
    );
  const response = await draftExec(client, rel, verb!, {
    commandId: idempotency,
    ...(verb === 'abandon' && flagString(args, 'reason') !== undefined
      ? { reason: flagString(args, 'reason') }
      : {}),
  });
  return envelope(`drafts.${verb}`, response.data);
}

async function activations(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const verb = args.words[1];
  const rel = args.words[2];
  if (rel === undefined || !['get', 'watch'].includes(verb ?? ''))
    throw new CliError('USAGE', 'activations get|watch requires rel', 2);
  if (verb === 'get')
    return envelope('activations.get', (await client.get(entityPath(rel, client.config))).data);
  const draft = rel.startsWith(DRAFT_ACTIVATION_PREFIX)
    ? `draft:${rel.slice(DRAFT_ACTIVATION_PREFIX.length)}`
    : rel;
  const response = await client.get(
    `/api/events?${new URLSearchParams({ rel: draft, afterSeq: String(flagNumber(args, 'after-seq', 0)!), limit: String(Math.min(flagNumber(args, 'limit', 20)!, 100)) })}`,
  );
  return envelope('activations.watch', response.data);
}

const DRAFT_ACTIVATION_PREFIX = 'meta/activation:draft-';

async function audit(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const anchor = args.words[1];
  const value = args.words[2];
  if (value === undefined || !['session', 'entity', 'definition', 'draft'].includes(anchor ?? ''))
    throw new CliError('USAGE', 'audit requires session|entity|definition|draft and id', 2);
  const rel =
    anchor === 'session'
      ? `chat:${value}`
      : anchor === 'definition'
        ? `meta/flow:${value}`
        : anchor === 'draft'
          ? draftRel(value)
          : value;
  const query = new URLSearchParams({
    rel,
    afterSeq: String(flagNumber(args, 'after-seq', 0)!),
    limit: String(Math.min(flagNumber(args, 'limit', 20)!, 100)),
  });
  const response = await client.get(`/api/events?${query}`);
  const body = dataOf(response);
  const page = record(body.page) ? body.page : {};
  return envelope(`audit.${anchor}`, body.events ?? [], undefined, {
    nextCursor: (page.nextAfterSeq as string | number | null) ?? null,
    hasMore: page.hasMore as boolean | undefined,
  });
}

async function rawRequest(args: ParsedArgs, client: Ui4aHttpClient): Promise<SuccessEnvelope> {
  const verb = args.words[1]?.toUpperCase();
  const path = args.words[2];
  if ((verb !== 'GET' && verb !== 'HEAD') || path === undefined)
    throw new CliError('USAGE', 'request supports get|head and requires path', 2);
  const response = await client.request(path, { method: verb, rawRead: true });
  return envelope(`request.${verb.toLowerCase()}`, {
    status: response.status,
    body: response.data,
  });
}

export async function runCommand(
  args: ParsedArgs,
  client: Ui4aHttpClient,
): Promise<SuccessEnvelope> {
  const noun = args.words[0];
  if (noun === 'doctor') return doctor(client);
  if (noun === 'apps') return apps(args, client);
  if (noun === 'flows') return flows(args, client);
  if (noun === 'entities') return entities(args, client);
  if (noun === 'catalog') return catalog(client);
  if (noun === 'actions') return actions(args, client);
  if (noun === 'plans') return plans(args, client);
  if (noun === 'bundles') return bundles(args, client);
  if (noun === 'drafts') return drafts(args, client);
  if (noun === 'activations') return activations(args, client);
  if (noun === 'audit') return audit(args, client);
  if (noun === 'request') return rawRequest(args, client);
  throw new CliError('USAGE', 'unknown command; run ui4a --help', 2);
}
