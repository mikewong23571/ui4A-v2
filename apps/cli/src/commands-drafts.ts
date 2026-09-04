import { flagNumber, flagString } from './args.js';
import type { ParsedArgs } from './args.js';
import { CliError, type SuccessEnvelope } from './envelope.js';
import type { Ui4aHttpClient } from './http.js';
import {
  commandId,
  dataOf,
  draftRel,
  entityPath,
  envelope,
  jsonFlagOrFile,
  metaExecPath,
  record,
  writeIdentity,
} from './command-helpers.js';

const DRAFT_ACTIVATION_PREFIX = 'meta/activation:draft-';

const PAYLOAD_SCHEMAS_FIELD = 'x-ui4a-payload-schemas';

// T50 Phase 5 / D69.5:零内嵌真相的 schema 语法糖——只读取 meta/drafts create
// 动作 fields 顶层的 x-ui4a-payload-schemas 合同注解(kind → { schema,
// example? })并原样透传;create 动作缺失、注解缺失或 kind 未被服务端注解
// 时诚实输出空表——不造默认 schema,也没有本地 kind 白名单。
function payloadSchemas(entity: Record<string, unknown>, kind?: string): Record<string, unknown> {
  const actions = Array.isArray(entity.actions) ? entity.actions.filter(record) : [];
  const create = actions.find((row) => row.name === 'create');
  const fields = create !== undefined && record(create.fields) ? create.fields : undefined;
  const annotation = fields?.[PAYLOAD_SCHEMAS_FIELD];
  if (!record(annotation)) return {};
  if (kind === undefined) return annotation;
  return kind in annotation ? { [kind]: annotation[kind] } : {};
}

async function draftExec(client: Ui4aHttpClient, rel: string, actionName: string, params: unknown) {
  const body = writeIdentity(client, { rel, action: actionName, params });
  const path = metaExecPath(client.config);
  try {
    return await client.post(path, body);
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'NETWORK') throw error;
    return client.post(path, body);
  }
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
      commandId: commandId(args),
      payload,
    });
    return envelope('drafts.create', response.data);
  }
  if (verb === 'schema') {
    const response = await client.get(entityPath('meta/drafts', client.config));
    const entity = dataOf(response);
    return envelope('drafts.schema', {
      schemas: payloadSchemas(entity, flagString(args, 'kind')),
    });
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
      'drafts supports create|get|list|revise|schema|validate|diff|submit|watch|abandon',
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

export async function runDraftCommand(
  args: ParsedArgs,
  client: Ui4aHttpClient,
): Promise<SuccessEnvelope | undefined> {
  const noun = args.words[0];
  if (noun === 'drafts') return drafts(args, client);
  if (noun === 'activations') return activations(args, client);
  return undefined;
}
