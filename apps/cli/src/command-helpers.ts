import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ParsedArgs } from './args.js';
import { flagString } from './args.js';
import type { CliConfig } from './config.js';
import { CliError, success, type SuccessEnvelope } from './envelope.js';
import type { Ui4aHttpClient } from './http.js';

export interface Sitemap {
  protocolVersion?: string;
  version?: string;
  applications?: Record<string, unknown>[];
  flows?: Record<string, unknown>[];
  capabilities?: Record<string, unknown>[];
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function dataOf(response: { data: unknown }): Record<string, unknown> {
  if (!record(response.data)) throw new CliError('PROTOCOL', 'expected JSON object', 9);
  return response.data;
}

export function commandId(args: ParsedArgs): string {
  return flagString(args, 'command-id') ?? randomUUID();
}

export async function jsonFlagOrFile(
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

export function entityPath(rel: string, config: CliConfig): string {
  const meta = rel.startsWith('meta/') || rel.startsWith('draft:');
  const base = meta ? '/_meta/api/entity' : '/api/entity';
  const query = new URLSearchParams({ rel });
  if (meta && config.token === undefined) query.set('policyScope', config.policyScope);
  return `${base}?${query}`;
}

export function writeIdentity(
  client: Ui4aHttpClient,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const adapted = { ...body };
  delete adapted.actor;
  delete adapted.principal;
  delete adapted.channel;
  if (client.config.token !== undefined) {
    if (Array.isArray(adapted.steps)) {
      adapted.steps = adapted.steps.map((step) => {
        if (!record(step)) return step;
        const sanitized = { ...step };
        delete sanitized.actor;
        delete sanitized.principal;
        delete sanitized.channel;
        return sanitized;
      });
    }
    return adapted;
  }
  return {
    ...adapted,
    actor: 'agent',
    principal: client.config.principal,
    channel: 'cli',
  };
}

export async function sitemap(client: Ui4aHttpClient): Promise<Sitemap> {
  return dataOf(await client.get('/.well-known/ui4a.json')) as Sitemap;
}

export function envelope(
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

export function draftRel(value: string): string {
  return value.startsWith('draft:') ? value : `draft:${value}`;
}
