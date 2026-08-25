import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { flagString } from './args.js';
import type { ParsedArgs } from './args.js';
import { CliError, type SuccessEnvelope } from './envelope.js';
import type { Ui4aHttpClient } from './http.js';
import { dataOf, entityPath, envelope, record } from './command-helpers.js';

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

export async function runBundleCommand(
  args: ParsedArgs,
  client: Ui4aHttpClient,
): Promise<SuccessEnvelope | undefined> {
  if (args.words[0] === 'bundles') return bundles(args, client);
  return undefined;
}
