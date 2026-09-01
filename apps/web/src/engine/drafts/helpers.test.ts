import { afterEach, describe, expect, it, vi } from 'vitest';

import { registries } from './helpers';

afterEach(() => vi.unstubAllEnvs());

describe('Draft validation registries', () => {
  it('uses the same Native Function executor and availability registries as activation', () => {
    vi.stubEnv(
      'UI4A_NATIVE_FUNCTION_PROFILES',
      JSON.stringify([
        {
          schemaVersion: 1,
          ref: 'reference-normalize-default',
          version: '1',
          executorClass: 'native-function',
          handlerRef: 'reference/text-normalize@1',
          adapterVersion: 'native-function@1',
          availability: { status: 'available' },
          limits: {
            startToCloseTimeoutMs: 5_000,
            maximumAttempts: 2,
            inputBytes: 4096,
            outputBytes: 4096,
          },
          network: 'denied',
        },
      ]),
    );
    const resolved = registries({
      applications: { reference: {} },
      capabilities: {},
    } as never);
    expect(resolved.executorProfiles.get('reference-normalize-default')).toBe('native-function');
    expect(resolved.nativeFunctionProfiles.get('reference-normalize-default')).toMatchObject({
      executorClass: 'native-function',
      handlerRef: 'reference/text-normalize@1',
      available: true,
    });
  });
});
