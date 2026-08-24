import { describe, expect, it } from 'vitest';

import type { ProductionDeploymentConfig } from '@ui4a/shared';

import { composeProductionWritingAgent } from './production';

function config(): ProductionDeploymentConfig {
  return {
    settings: {
      llm: {
        baseUrl: 'https://llm.internal/v1',
        model: 'production-model',
        apiKeyRef: 'llm-api-key',
      },
      runtime: {
        defaultProfiles: { writing: 'writing-k8s' },
        profiles: [
          {
            id: 'writing-k8s',
            specialization: 'writing',
            backend: 'kubernetes',
            workspaceRoot: '/workspaces/writing',
            timeoutSeconds: 900,
          },
        ],
      },
    },
  } as unknown as ProductionDeploymentConfig;
}

describe('T22 production Writing Agent composition', () => {
  it('derives one exact adapter profile and remote probe from canonical production config', async () => {
    delete process.env.UI4A_DOCUMENT_AGENT_PROFILES;
    delete process.env.UI4A_DOCUMENT_WORKSPACE_ROOT;

    const composition = composeProductionWritingAgent(config());

    expect(composition.workspaceRoot).toBe('/workspaces/writing');
    expect(composition.workspaceRootForRun('agent-run:writing:42')).toBe(
      '/workspaces/writing/agent-run:writing:42/agent',
    );
    expect(composition.profiles).toEqual([
      expect.objectContaining({
        name: 'writing-k8s',
        runtimeClass: 'document-agent',
        providerId: 'codex',
        model: 'production-model',
        endpoint: 'https://llm.internal/v1',
        timeoutSeconds: 900,
      }),
    ]);
    await expect(composition.probe()).resolves.toEqual({ available: true });
  });

  it('fails closed when the canonical default is missing or not an exact writing profile', () => {
    const missing = config();
    missing.settings.runtime.profiles = [];
    expect(() => composeProductionWritingAgent(missing)).toThrow(
      'production_writing_profile_invalid',
    );

    const wrong = config();
    wrong.settings.runtime.profiles[0] = {
      ...wrong.settings.runtime.profiles[0]!,
      specialization: 'coding',
    } as (typeof wrong.settings.runtime.profiles)[number];
    expect(() => composeProductionWritingAgent(wrong)).toThrow(
      'production_writing_profile_invalid',
    );
  });
});
