import { describe, expect, it } from 'vitest';

import { resolveExecutorProfile, type ExecutorProfile } from './index';

const profile: ExecutorProfile = {
  name: 'default',
  executorClass: 'coding-agent',
  providerId: 'provider:primary',
  transport: 'structured-stream',
  workspaceBackend: 'isolated-worktree',
  sandbox: 'workspace-write',
  timeoutSeconds: 900,
  maxTurns: 30,
  envAllowlist: [],
  networkPolicy: 'none',
};

describe('executor profile resolution', () => {
  it('resolves one healthy compatible server-owned profile', () => {
    expect(
      resolveExecutorProfile({
        requirement: { executorClass: 'coding-agent', requiredFeatures: ['resume'] },
        policyProfileName: 'default',
        profiles: [profile],
        descriptors: [
          {
            schemaVersion: 1,
            profileName: 'default',
            available: true,
            taskSchemaVersions: [1],
            features: ['resume'],
          },
        ],
      }),
    ).toMatchObject({ ok: true, profile });
  });

  it.each(['provider', 'binary', 'model', 'sandbox', 'yolo', 'profile'])(
    'rejects request override %s',
    (key) => {
      expect(
        resolveExecutorProfile({
          requirement: { executorClass: 'coding-agent' },
          policyProfileName: 'default',
          profiles: [profile],
          descriptors: [],
          request: { [key]: 'override' },
        }),
      ).toMatchObject({ ok: false, code: 'request-override-forbidden' });
    },
  );

  it('fails closed without fallback for missing, unhealthy, or incompatible profiles', () => {
    expect(
      resolveExecutorProfile({
        requirement: { executorClass: 'coding-agent' },
        policyProfileName: 'missing',
        profiles: [profile],
        descriptors: [],
      }),
    ).toMatchObject({ ok: false, code: 'profile-missing' });
    expect(
      resolveExecutorProfile({
        requirement: { executorClass: 'coding-agent' },
        policyProfileName: 'default',
        profiles: [profile, { ...profile, name: 'fallback' }],
        descriptors: [
          {
            schemaVersion: 1,
            profileName: 'default',
            available: false,
            taskSchemaVersions: [1],
            features: [],
            reason: 'not authenticated',
          },
          {
            schemaVersion: 1,
            profileName: 'fallback',
            available: true,
            taskSchemaVersions: [1],
            features: [],
          },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'profile-unavailable' });
    expect(
      resolveExecutorProfile({
        requirement: { executorClass: 'coding-agent', requiredFeatures: ['resume'] },
        policyProfileName: 'default',
        profiles: [profile],
        descriptors: [
          {
            schemaVersion: 1,
            profileName: 'default',
            available: true,
            taskSchemaVersions: [1],
            features: [],
          },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'profile-incompatible' });
  });
});
