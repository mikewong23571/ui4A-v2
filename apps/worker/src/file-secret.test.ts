import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCapabilityCallbackToken } from './file-secret';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function secretFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'ui4a-worker-callback-'));
  roots.push(root);
  const path = join(root, 'callback-token');
  writeFileSync(path, '__private_callback_value__', { mode: 0o600 });
  return path;
}

describe('Worker callback file Secret startup loader', () => {
  it('loads file material while preserving direct environment compatibility', () => {
    const fromFile: NodeJS.ProcessEnv = { UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: secretFile() };
    const direct: NodeJS.ProcessEnv = {
      UI4A_CAPABILITY_CALLBACK_TOKEN: '__direct_callback_value__',
    };

    expect(loadCapabilityCallbackToken(fromFile)).toBeUndefined();
    expect(fromFile.UI4A_CAPABILITY_CALLBACK_TOKEN).toBe('__private_callback_value__');
    expect(loadCapabilityCallbackToken(direct)).toBeUndefined();
    expect(direct.UI4A_CAPABILITY_CALLBACK_TOKEN).toBe('__direct_callback_value__');
  });

  it('rejects ambiguous and unsafe file sources', () => {
    const path = secretFile();
    const link = `${path}.link`;
    symlinkSync(path, link);

    for (const environment of [
      {
        UI4A_CAPABILITY_CALLBACK_TOKEN: '__direct__',
        UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: path,
      },
      { UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: 'relative' },
      { UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: link },
    ]) {
      expect(() => loadCapabilityCallbackToken(environment)).toThrow(
        'UI4A_CALLBACK_TOKEN_FILE_INVALID',
      );
    }
  });
});
