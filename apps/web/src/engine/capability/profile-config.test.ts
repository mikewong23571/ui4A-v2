import { describe, expect, it } from 'vitest';

import {
  nativeFunctionActivationRegistryFromEnvironment,
  nativeFunctionExecutorClassRegistryFromEnvironment,
  nativeFunctionProfileMapFromEnvironment,
} from './profile-config';

const profile = {
  schemaVersion: 1,
  ref: 'security-enrichment-default',
  version: '1',
  executorClass: 'native-function',
  handlerRef: 'security/cve-enrich@1',
  adapterVersion: 'native-function@1',
  availability: { status: 'available' },
  limits: {
    startToCloseTimeoutMs: 30_000,
    maximumAttempts: 3,
    inputBytes: 16_384,
    outputBytes: 32_768,
  },
  network: 'denied',
};

describe('Native Function server-owned profile registry', () => {
  it('is empty when deployment config is absent', () => {
    expect(nativeFunctionProfileMapFromEnvironment({}).size).toBe(0);
  });

  it('projects one strict profile into runtime and activation registries', () => {
    const environment = { UI4A_NATIVE_FUNCTION_PROFILES: JSON.stringify([profile]) };
    expect(nativeFunctionProfileMapFromEnvironment(environment).get(profile.ref)).toEqual(profile);
    expect(nativeFunctionExecutorClassRegistryFromEnvironment(environment).get(profile.ref)).toBe(
      'native-function',
    );
    expect(nativeFunctionActivationRegistryFromEnvironment(environment).get(profile.ref)).toEqual({
      executorClass: 'native-function',
      handlerRef: profile.handlerRef,
      available: true,
    });
  });

  it('fails closed on malformed JSON and unknown deployment fields', () => {
    expect(() =>
      nativeFunctionProfileMapFromEnvironment({ UI4A_NATIVE_FUNCTION_PROFILES: '{' }),
    ).toThrow();
    expect(() =>
      nativeFunctionProfileMapFromEnvironment({
        UI4A_NATIVE_FUNCTION_PROFILES: JSON.stringify([{ ...profile, endpoint: 'hidden' }]),
      }),
    ).toThrow(/endpoint/);
  });
});
