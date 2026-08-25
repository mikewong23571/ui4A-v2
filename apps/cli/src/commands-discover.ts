import { CLI_VERSION, CliError, type SuccessEnvelope } from './envelope.js';
import type { Ui4aHttpClient } from './http.js';
import type { ParsedArgs } from './args.js';
import { entityPath, envelope, record, sitemap } from './command-helpers.js';

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

export async function runDiscoverCommand(
  args: ParsedArgs,
  client: Ui4aHttpClient,
): Promise<SuccessEnvelope | undefined> {
  const noun = args.words[0];
  if (noun === 'doctor') return doctor(client);
  if (noun === 'apps') return apps(args, client);
  if (noun === 'flows') return flows(args, client);
  if (noun === 'entities') return entities(args, client);
  if (noun === 'catalog') return catalog(client);
  return undefined;
}
