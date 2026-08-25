import { flagNumber } from './args.js';
import type { ParsedArgs } from './args.js';
import { CliError, type SuccessEnvelope } from './envelope.js';
import type { Ui4aHttpClient } from './http.js';
import { dataOf, draftRel, envelope, record } from './command-helpers.js';

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

export async function runAuditCommand(
  args: ParsedArgs,
  client: Ui4aHttpClient,
): Promise<SuccessEnvelope | undefined> {
  const noun = args.words[0];
  if (noun === 'audit') return audit(args, client);
  if (noun === 'request') return rawRequest(args, client);
  return undefined;
}
