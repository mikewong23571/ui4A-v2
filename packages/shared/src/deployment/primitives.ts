/**
 * 部署配置解析的共享校验原语(自 production-deployment-config.ts 拆出,行为不变)。
 * 模块内部使用,不经 barrel 导出。
 */
import { ProductionDeploymentConfigError } from './types';

export function fail(path: string, reason: string): never {
  throw new ProductionDeploymentConfigError(path, reason);
}

export function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

export function exactObject(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const parsed = object(value, path);
  const unknownKey = Object.keys(parsed).find((key) => !allowedKeys.includes(key));
  if (unknownKey !== undefined) fail(`${path}.${unknownKey}`, 'unknown field');
  return parsed;
}

export function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'is required');
  return value.trim();
}

export function identifier(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parsed)) {
    fail(path, 'must be a stable identifier');
  }
  return parsed;
}

export function integer(value: unknown, path: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `must be an integer >= ${minimum}`);
  }
  return value as number;
}

export function enumValue<const T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(path, `must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty array');
  return value.map((entry, index) => string(entry, `${path}[${index}]`));
}

export function absolutePath(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!parsed.startsWith('/') || parsed === '/' || parsed.includes('\0')) {
    fail(path, 'must be a non-root absolute path');
  }
  return parsed;
}

export function hostname(value: unknown, path: string): string {
  const parsed = string(value, path).toLowerCase();
  if (
    parsed === 'localhost' ||
    parsed === '0.0.0.0' ||
    parsed === '::1' ||
    parsed.startsWith('127.') ||
    parsed.includes('/') ||
    parsed.includes(':')
  ) {
    fail(path, 'localhost, loopback, URL and port values are forbidden in production hosts');
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(parsed) || parsed.includes('..')) {
    fail(path, 'must be a valid production hostname');
  }
  return parsed;
}

export function httpsUrl(value: unknown, path: string): URL {
  const parsed = string(value, path);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    fail(path, 'must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:') fail(path, 'must use HTTPS in production');
  hostname(url.hostname, path);
  if (url.username !== '' || url.password !== '') fail(path, 'must not contain credentials');
  return url;
}

export function parseSecrets(value: unknown): Record<string, string> {
  const candidate = object(value, 'secrets');
  const result: Record<string, string> = {};
  for (const [key, secret] of Object.entries(candidate)) {
    identifier(key, `secrets.${key}`);
    if (typeof secret !== 'string' || secret.trim() === '') {
      fail(`secrets.${key}`, 'Secret value must not be empty');
    }
    result[key] = secret;
  }
  return result;
}

export function requireSecret(
  secrets: Readonly<Record<string, string>>,
  ref: string,
  path: string,
): void {
  if (secrets[ref] === undefined) fail(path, `Secret ref ${ref} is required`);
}
