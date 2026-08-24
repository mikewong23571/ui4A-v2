import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { register } from './instrumentation';

const deploymentEnvironmentKeys = [
  'NEXT_RUNTIME',
  'UI4A_DEPLOYMENT_PROFILE',
  'UI4A_DEPLOYMENT_SETTINGS_JSON',
  'UI4A_DEPLOYMENT_SETTINGS_FILE',
  'UI4A_DEPLOYMENT_SECRETS_JSON',
  'UI4A_DEPLOYMENT_SECRETS_FILE',
] as const;

let originalEnvironment: Partial<Record<(typeof deploymentEnvironmentKeys)[number], string>>;

beforeEach(() => {
  originalEnvironment = Object.fromEntries(
    deploymentEnvironmentKeys.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );
  for (const key of deploymentEnvironmentKeys) delete process.env[key];
});

afterEach(() => {
  for (const key of deploymentEnvironmentKeys) {
    const original = originalEnvironment[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('Next.js instrumentation production preflight', () => {
  it('rejects Node startup when the explicit production profile is incomplete', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';

    await expect(register()).rejects.toThrow(/settings|UI4A_DEPLOYMENT_SETTINGS/i);
  });

  it.each([undefined, 'local'])(
    'allows Node startup for the %s deployment profile',
    async (profile) => {
      process.env.NEXT_RUNTIME = 'nodejs';
      if (profile !== undefined) process.env.UI4A_DEPLOYMENT_PROFILE = profile;

      await expect(register()).resolves.toBeUndefined();
    },
  );

  it('does not run the Node-only preflight in another Next runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';

    await expect(register()).resolves.toBeUndefined();
  });

  it('does not disclose a Secret canary in a startup rejection', async () => {
    const secretCanary = '__t22_instrumentation_secret_canary__';
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    process.env.UI4A_DEPLOYMENT_SETTINGS_JSON = '{}';
    process.env.UI4A_DEPLOYMENT_SECRETS_JSON = JSON.stringify({ token: secretCanary });

    let startupError: unknown;
    try {
      await register();
    } catch (error) {
      startupError = error;
    }

    expect(startupError).toBeInstanceOf(Error);
    expect(String(startupError)).not.toContain(secretCanary);
  });
});
