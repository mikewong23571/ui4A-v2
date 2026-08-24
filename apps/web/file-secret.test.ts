import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCapabilityCallbackToken } from './file-secret.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function secretFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'ui4a-web-callback-'));
  roots.push(root);
  const path = join(root, 'callback-token');
  writeFileSync(path, '__private_callback_value__', { mode: 0o600 });
  return path;
}

describe('Web callback file Secret startup loader', () => {
  it('loads a bounded absolute regular file before app startup without returning material', () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: secretFile(),
    };

    expect(loadCapabilityCallbackToken(environment)).toBeUndefined();
    expect(environment.UI4A_CAPABILITY_CALLBACK_TOKEN).toBe('__private_callback_value__');
  });

  it('keeps existing local and Kubernetes direct environment behavior', () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      UI4A_CAPABILITY_CALLBACK_TOKEN: '__direct_callback_value__',
    };

    expect(loadCapabilityCallbackToken(environment)).toBeUndefined();
    expect(environment.UI4A_CAPABILITY_CALLBACK_TOKEN).toBe('__direct_callback_value__');
  });

  it('rejects ambiguous, relative, symlinked, empty, and oversized file sources', () => {
    const path = secretFile();
    const link = `${path}.link`;
    symlinkSync(path, link);
    const empty = `${path}.empty`;
    writeFileSync(empty, '', { mode: 0o600 });
    const oversized = `${path}.oversized`;
    writeFileSync(oversized, 'x'.repeat(4097), { mode: 0o600 });

    for (const environment of [
      {
        NODE_ENV: 'test',
        UI4A_CAPABILITY_CALLBACK_TOKEN: '__direct__',
        UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: path,
      },
      { NODE_ENV: 'test', UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: 'relative' },
      { NODE_ENV: 'test', UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: link },
      { NODE_ENV: 'test', UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: empty },
      { NODE_ENV: 'test', UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: oversized },
    ] satisfies NodeJS.ProcessEnv[]) {
      expect(() => loadCapabilityCallbackToken(environment)).toThrow(
        'UI4A_CALLBACK_TOKEN_FILE_INVALID',
      );
    }
  });
});
